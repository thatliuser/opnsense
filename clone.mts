import { Proxmox, proxmoxApi } from "proxmox-api";
import { throwIfUndefined } from "./util.mts";
import { Command } from 'commander'
import 'dotenv/config'
import type { Config } from './config.mts'
import config from './tspmo.config.mts'
import { sleep } from './util.mts'
import ip from 'ipaddr.js'
import { onAdd, onDel, onUp, waitForGateways } from './index.mts'
import { env } from 'node:process'

// allow self-signed TLS cert
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

function getClient(): Proxmox.Api {
	const host = throwIfUndefined(env.PROXMOX_HOST)
	try {
		const username = throwIfUndefined(env.PROXMOX_USER)
		const password = throwIfUndefined(env.PROXMOX_PASS)
		// it says the default port is 8006 but i think it's lying
		return proxmoxApi({ host, username, password, port: 8006 })
	}
	catch (e) {
		console.log('Authentication with user credentials failed, trying token authentication')
		const tokenID = throwIfUndefined(env.PROXMOX_TOKEN_ID)
		const tokenSecret = throwIfUndefined(env.PROXMOX_TOKEN_SECRET)
		return proxmoxApi({ host, tokenID, tokenSecret, port: 8006 })
	}
}
const prox = getClient()

// Converts a config string, with key-value pairs using = separated by commas, into a Typescript record
function confToRecord(conf: string): Record<string, string> {
	const pairs = conf.split(',')
	const record: Record<string, string> = {}
	for (const pair of pairs) {
		const split = pair.split('=', 2)
		if (split.length < 2) {
			throw Error(`Configuration has an invalid key-value pair: ${conf}`)
		}
		const [key, val] = split
		record[key] = val
	}
	return record
}

function recordToConf(record: Record<string, string>): string {
	let output = ''
	for (const [key, val] of Object.entries(record)) {
		output += `${key}=${val},`
	}
	return output.slice(0, -1)
}

async function waitForTask(taskId: string, node: string) {
	while (true) {
		const data = await prox.nodes.$(node).tasks.$(taskId).status.$get()
		if (data.exitstatus !== undefined) {
			break
		}
		await sleep(500)
	}
}

async function waitForTasks(tasks: [string, string][]) {
	while (true) {
		const pair = tasks.pop()
		if (pair === undefined) {
			break
		}
		const [firstTask, taskNode] = pair
		await waitForTask(firstTask, taskNode)
	}
}

async function runTask(run: (config: Config, vmid: number, node: string) => Promise<string>, action: string) {
	const vmCount = config.templates.length * config.copies

	const tasks: [string, string][] = []
	for (let cloned = 0; cloned < config.copies; ++cloned) {
		const node = config.nodes[cloned % config.nodes.length]
		for (let i = 0; i < config.templates.length; ++i) {
			const vmid = config.startVmid + (cloned * config.templates.length) + i
			try {
				const task = await run(config, vmid, node)
				console.log(`${action} node ${vmid}`)
				tasks.push([task, node])
			}
			catch (e: any) {
				if (!(e instanceof Error)) {
					throw e
				}
				if (!e.message.includes('got no worker upid')) {
					throw e
				}
				console.log('Failed to run task, waiting for existing tasks to complete')
				await waitForTasks(tasks)
			}
		}
	}

	await waitForTasks(tasks)
}

async function stop() {
	await runTask((config: Config, vmid: number, node: string) => {
		return prox.nodes.$(node).qemu.$(vmid).status.stop.$post()
	}, 'Stopping')
}

async function start() {
	await runTask((config: Config, vmid: number, node: string) => {
		return prox.nodes.$(node).qemu.$(vmid).status.start.$post()
	}, 'Starting')
}

async function revert() {
	await stop()
	await runTask(async (config: Config, vmid: number, node: string) => {
		const snaps = await prox.nodes.$(node).qemu.$(vmid).snapshot.$get()
		for (const snap of snaps) {
			if (snap.parent === undefined) {
				return prox.nodes.$(node).qemu.$(vmid).snapshot.$(snap.name).rollback.$post()
			}
		}
		throw Error('No snapshot found with parent')
	}, 'Reverting')
}

async function destroy() {
	await stop()
	await runTask(async (config: Config, vmid: number, node: string) => {
		return prox.nodes.$(node).qemu.$(vmid).$delete({
			"destroy-unreferenced-disks": true,
			purge: true,
		})
	}, 'Destroying')
}

// TODO: make this also use runTask
async function clone() {
	// Initialize the IPv4 of the router
	let ipv4 = config.firstRouter

	for (let cloned = 0; cloned < config.copies; ++cloned) {
		const node = config.nodes[cloned % config.nodes.length]
		for (let i = 0; i < config.templates.length; ++i) {
			const template = config.templates[i]
			const templateConfig = await prox.nodes.$(node).qemu.$(template).config.$get()
			const newVm = config.startVmid + (cloned * config.templates.length) + i
			console.log(`Cloning VM ${newVm} from template ${template}`)
			await waitForTask(await prox.nodes.$(node).qemu.$(template).clone.$post({
				newid: newVm,
				name: `${templateConfig.name}-${cloned + 1}`,
				target: node,
				full: false,
			}), node)
			if (templateConfig.net1 !== undefined) {
				// Router
				console.log(`Setting router IP to ${ipv4}/24`)
				const map = confToRecord(templateConfig.net1)
				map['bridge'] = config.bridge
				map['tag'] = (config.startVlan + cloned).toString()
				await prox.nodes.$(node).qemu.$(newVm).config.$post({
					ipconfig0: `ip=${ipv4}/24,gw=${config.gateway}`,
					net1: recordToConf(map)
				})
			} else {
				if (templateConfig.net0 === undefined) {
					throw Error('Template does not have a NIC')
				}
				const map = confToRecord(templateConfig.net0)
				map['bridge'] = config.bridge
				map['tag'] = (config.startVlan + cloned).toString()
				await prox.nodes.$(node).qemu.$(newVm).config.$post({
					net0: recordToConf(map)
				})
			}
			await prox.nodes.$(node).qemu.$(newVm).snapshot.$post({
				snapname: 'base',
				vmstate: false,
			})
		}

		// Update the router IP for the next clone
		// We assume a /24 CIDR
		const bytes = ipv4.toByteArray()
		bytes[2] += 1
		ipv4 = new ip.IPv4(bytes)
	}
}

async function ping() {
	// only ping all the routers
	for (let cloned = 0; cloned < config.copies; ++cloned) {
		const node = config.nodes[cloned % config.nodes.length]
		const vmid = config.startVmid + (cloned * config.templates.length)
		while (true) {
			try {
				const resp = await prox.nodes.$(node).qemu.$(vmid).agent.ping.$post()
				console.log(`Got response ${JSON.stringify(resp)} for vmid ${vmid}`)
				break
			}
			catch (e: any) {
				if (!(e instanceof Error)) {
					throw e
				}
				// TODO: match VM * is not running and QEMU guest agent is not running
				if (!e.message.includes('is not running')) {
					throw e
				}
				console.log(`Failed to ping guest agent, sleeping and retrying: ${e}`)
				await sleep(1000)
			}
		}
	}
}

// Clones the network, starts everything, checks if all routers are up, sets gateways as up, waits for gateways to be online, sets routes as up
async function up() {
	const doClone = async (): Promise<void> => {
		await clone()
		await start()
		await ping()
	}
	// We can add the gateways and routes in parallel
	await Promise.all([doClone(), onAdd()])
	// We only want to set the gateways as up after everything is already up
	await onUp(false)
	const gws: string[] = []
	let ipv4 = config.firstRouter
	for (let cloned = 0; cloned < config.copies; ++cloned) {
		gws.push(ipv4.toNormalizedString())
		// Update the router IP for the next clone
		// We assume a /24 CIDR
		const bytes = ipv4.toByteArray()
		bytes[2] += 1
		ipv4 = new ip.IPv4(bytes)
	}
	await waitForGateways(gws)
	// Now set the route as up
	await onUp(true)
}

// Deletes routes, destroys VMs
async function down() {
	await Promise.all([destroy(), onDel(undefined)])
}

if (import.meta.main) {
	const cli = new Command()

	cli.command('clone')
		.action(clone)

	cli.command('start')
		.action(start)

	cli.command('stop')
		.action(stop)

	cli.command('revert')
		.action(revert)

	cli.command('destroy')
		.action(destroy)

	cli.command('ping')
		.action(ping)

	cli.command('up')
		.action(up)

	cli.command('down')
		.action(down)

	await cli.parseAsync()
}
