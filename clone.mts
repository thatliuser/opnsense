import proxmoxApi from "proxmox-api";
import { throwIfUndefined } from "./util.mts";
import { Command } from 'commander'
import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import z from 'zod'
import { sleep } from './util.mts'
import ip from 'ipaddr.js'

const Config = z.object({
	nodes: z.array(z.string()),
	copies: z.number().gt(0),
	startVmid: z.number().gt(0),
	firstRouter: z.ipv4(),
	// TODO: this can be hardcoded for now?
	gateway: z.ipv4(),
	firstBridge: z.number().gt(0),
	templates: z.array(z.number()),
})

// allow self-signed TLS cert
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

const host = throwIfUndefined(process.env.PROXMOX_HOST)
const username = throwIfUndefined(process.env.PROXMOX_USER)
const password = throwIfUndefined(process.env.PROXMOX_PASS)
// it says the default port is 8006 but i think it's lying
const prox = proxmoxApi({ host, username, password, port: 8006 })

async function getConfig(path: string): Promise<z.infer<typeof Config>> {
	const buffer = await readFile(path)
	const contents = buffer.toString('utf8')
	const json = JSON.parse(contents)
	return Config.parse(json)
}

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
		await sleep(0.1)
	}
}

async function runTask(run: (config: z.infer<typeof Config>, vmid: number) => Promise<string>, action: string) {
	const config = await getConfig('clone.json')
	const vmCount = config.templates.length * config.copies

	const tasks: string[] = []
	for (let i = 0; i < vmCount; ++i) {
		const vmid = i + config.startVmid
		try {
			const task = await run(config, vmid)
			console.log(`${action} node ${vmid}`)
			tasks.push(task)
		}
		catch (e: any) {
			if (!(e instanceof Error)) {
				throw e
			}
			if (!e.message.includes('got no worker upid')) {
				throw e
			}
			console.log('Failed to run task, waiting for existing tasks to complete')
			while (true) {
				const firstTask = tasks.pop()
				if (firstTask === undefined) {
					break
				}
				await waitForTask(firstTask, config.nodes[0])
			}
		}
	}
}

async function stop() {
	await runTask((config: z.infer<typeof Config>, vmid: number) => {
		return prox.nodes.$(config.nodes[0]).qemu.$(vmid).status.stop.$post()
	}, 'Stopping')
}

async function start() {
	await runTask((config: z.infer<typeof Config>, vmid: number) => {
		return prox.nodes.$(config.nodes[0]).qemu.$(vmid).status.start.$post()
	}, 'Starting')
}

async function revert() {
	await stop()
	await runTask(async (config: z.infer<typeof Config>, vmid: number) => {
		const snaps = await prox.nodes.$(config.nodes[0]).qemu.$(vmid).snapshot.$get()
		let reverted = false
		for (const snap of snaps) {
			if (snap.parent === undefined) {
				return prox.nodes.$(config.nodes[0]).qemu.$(vmid).snapshot.$(snap.name).rollback.$post()
			}
		}
		throw Error('No snapshot found with parent')
	}, 'Reverting')
}

async function destroy() {
	await stop()
	await runTask(async (config: z.infer<typeof Config>, vmid: number) => {
		return prox.nodes.$(config.nodes[0]).qemu.$(vmid).$delete({
			"destroy-unreferenced-disks": true,
			purge: true,
		})
	}, 'Destroying')
}

async function clone() {
	const config = await getConfig('clone.json')
	// Initialize the IPv4 of the router
	let ipv4 = ip.parse(config.firstRouter)
	if (!(ipv4 instanceof ip.IPv4)) {
		throw new Error('IPv6 is not supported for now')
	}

	for (let cloned = 0; cloned < config.copies; ++cloned) {
		for (let i = 0; i < config.templates.length; ++i) {
			const template = config.templates[i]
			const templateConfig = await prox.nodes.$(config.nodes[0]).qemu.$(template).config.$get()
			const newVm = config.startVmid + (cloned * config.templates.length) + i
			console.log(`Cloning VM ${newVm} from template ${template}`)
			await waitForTask(await prox.nodes.$(config.nodes[0]).qemu.$(template).clone.$post({
				newid: newVm,
				name: `${templateConfig.name}-${cloned}`,
				target: config.nodes[0],
				full: false,
			}), config.nodes[0])
			if (templateConfig.net1 !== undefined) {
				// Router
				console.log(`Setting router IP to ${ipv4}/24`)
				await prox.nodes.$(config.nodes[0]).qemu.$(newVm).config.$post({
					ipconfig0: `ip=${ipv4}/24,gw=${config.gateway}`
				})
			} else {
				if (templateConfig.net0 === undefined) {
					throw Error('Template does not have a NIC')
				}
				const map = confToRecord(templateConfig.net0)
				map['bridge'] = `vmbr${config.firstBridge + cloned}`
				// TODO: implement
				await prox.nodes.$(config.nodes[0]).qemu.$(newVm).config.$post({
					net0: recordToConf(map)
				})
			}
			await prox.nodes.$(config.nodes[0]).qemu.$(newVm).snapshot.$post({
				snapname: 'base',
				vmstate: false,
			})
		}

		// Update the router IP for the next clone
		// We assume a /24 CIDR
		const bytes = ipv4.toByteArray()
		bytes[2] += 1
		ipv4 = ip.fromByteArray(bytes)
	}
}

const cli = new Command()

cli.command('clone')
	.action(clone)

cli.command('start')
	.action(start)

cli.command('stop')
	.action(revert)

cli.command('destroy')
	.action(destroy)

await cli.parseAsync()
