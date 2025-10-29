import OPNsenseClient from '@richard-stovall/opnsense-typescript-client'
import { getClient, Gateways, GatewayType, Routes, RouteType } from './opn.mts'
import { Command } from 'commander'
import z from 'zod'
import ip from 'ipaddr.js'
import 'dotenv/config'
import { sleep } from './util.mts'
import { Config, config } from './config.mts'

async function getGateways(client: OPNsenseClient): Promise<z.infer<typeof Gateways>> {
	const gateways = await client.routing.settingsSearchGateway()
	if (gateways.data.rows !== undefined) {
		return Gateways.parse(gateways.data.rows)
	}
	throw new Error(`Failed to search gateways: ${gateways.data.message}`)
}

async function getRoutes(client: OPNsenseClient): Promise<z.infer<typeof Routes>> {
	const routes = await client.routes.routesSearchroute()
	if (routes.data.rows !== undefined) {
		return Routes.parse(routes.data.rows)
	}
	throw new Error(`Failed to search routes: ${routes.data.message}`)
}

export async function onUpDown(up: boolean, route: boolean) {
	const caption = up ? 'up' : 'down'
	const disabled = up ? '0' : '1'
	const client = await getClient()
	const gateways = await getGateways(client)
	const routes = await getRoutes(client)

	let ipv4 = config.firstRouter

	for (let i = 0; i < config.copies; ++i) {
		const gatewayName = `${config.gwPrefix}-gateway-${i}`
		const foundGw = gateways.find((gw) => gw.name === gatewayName)
		if (foundGw === undefined) {
			throw new Error(`Gateway ${gatewayName} not found; have you created the gateways yet with 'add'?`)
		}

		if (foundGw.gateway === undefined) {
			throw new Error(`Gateway ${foundGw.name} has an undefined gateway`)
		}

		const data: GatewayType = {
			gateway_item: {
				data_length: '',
				defaultgw: '0',
				descr: '',
				disabled: disabled,
				fargw: '0',
				force_down: '0',
				// IP address
				gateway: foundGw.gateway,
				interface: 'lan',
				interval: '',
				ipprotocol: 'inet',
				latencyhigh: '',
				latencylow: '',
				loss_interval: '',
				losshigh: '',
				losslow: '',
				// IP address
				monitor: foundGw.gateway,
				monitor_disable: '0',
				monitor_noroute: '0',
				name: foundGw.name,
				priority: '255',
				time_period: '',
				weight: '1',
			}
		}
		console.log(`Setting gateway ${foundGw.name} as ${caption}`)
		const resp = await client.routing.settingsSetGateway(foundGw.uuid, data)
		if (resp.data.result !== 'saved') {
			throw new Error(`Failed to set gateway: ${JSON.stringify(resp.data)}`)
		}

		if (route) {
			const foundRoute = routes.find((route) => route.gateway === `${foundGw.name} - ${foundGw.gateway}`)
			if (foundRoute !== undefined) {
				const bytes = ipv4.toByteArray()
				bytes[3] = 0
				const cidr = `${ip.fromByteArray(bytes)}/24`
				const data: RouteType = {
					route: {
						descr: '',
						disabled: disabled,
						gateway: gatewayName,
						network: cidr,
					}
				}
				console.log(`Setting route ${foundRoute.network} with gateway ${foundRoute.gateway} as ${caption}`)
				const resp = await client.routes.routesSetroute(foundRoute.uuid, data)
				if (resp.data.result !== 'saved') {
					throw new Error(`Failed to set route: ${JSON.stringify(resp.data)}`)
				}
			}
			else {
				throw new Error(`Route with gateway ${gatewayName} not found; have you created the gateways yet with 'add'?`)
			}
		}

		// We assume a /24 CIDR
		const bytes = ipv4.toByteArray()
		bytes[2] += 1
		ipv4 = new ip.IPv4(bytes)
	}

	let resp = await client.routing.settingsReconfigure()
	if (resp.data.status !== 'ok') {
		throw new Error(`Failed to reconfigure routing settings: ${JSON.stringify(resp.data)}`)
	}


	resp = await client.routes.routesReconfigure()
	if (resp.data.status !== 'ok') {
		throw new Error(`Failed to reconfigure route settings: ${JSON.stringify(resp.data)}`)
	}
}

export async function onUp(route: boolean | undefined) {
	route = route ?? false
	await onUpDown(true, route)
}

export async function onDown(route: boolean | undefined) {
	route = route ?? false
	await onUpDown(false, route)
}

export async function onAdd() {
	const client = await getClient()
	const gateways = await getGateways(client)
	const routes = await getRoutes(client)

	let ipv4 = config.firstRouter

	const addedGateways: [string, string][] = []
	for (let i = 0; i < config.copies; ++i) {
		const gatewayName = `${config.gwPrefix}-gateway-${i}`
		if (!gateways.find((gw) => gw.name === gatewayName)) {
			const ipStr = ipv4.toNormalizedString()
			console.log(`Adding gateway ${gatewayName} with IP ${ipStr}`)
			const data: GatewayType = {
				gateway_item: {
					data_length: '',
					defaultgw: '0',
					descr: '',
					disabled: '1',
					fargw: '0',
					force_down: '0',
					// IP address
					gateway: ipStr,
					interface: 'lan',
					interval: '',
					ipprotocol: 'inet',
					latencyhigh: '',
					latencylow: '',
					loss_interval: '',
					losshigh: '',
					losslow: '',
					// IP address
					monitor: ipStr,
					monitor_disable: '0',
					monitor_noroute: '0',
					name: gatewayName,
					priority: '255',
					time_period: '',
					weight: '1',
				}
			}
			const resp = await client.routing.settingsAddGateway(data)
			if (resp.data.result !== 'saved') {
				throw new Error(`Failed to add gateway: ${JSON.stringify(resp.data)}`)
			}
		}
		let bytes = ipv4.toByteArray()
		bytes[3] = 0
		const cidr = `${ip.fromByteArray(bytes)}/24`
		addedGateways.push([gatewayName, cidr])
		// We assume a /24 CIDR
		bytes = ipv4.toByteArray()
		bytes[2] += 1
		ipv4 = new ip.IPv4(bytes)
	}

	for (const [gw, cidr] of addedGateways) {
		if (!routes.find((route) => route.gateway.startsWith(gw))) {
			while (true) {
				console.log(`Adding route ${cidr}`)
				const data: RouteType = {
					route: {
						descr: '',
						disabled: '1',
						gateway: gw,
						network: cidr,
					}
				}
				const resp = await client.routes.routesAddroute(data)
				if (resp.data.result === 'saved') {
					break
				}

				const str = JSON.stringify(resp.data)
				if (str.includes("Specify a valid gateway")) {
					console.log("Waiting for a second since gateways seemed to not apply")
					await sleep(1000)
				} else {
					throw new Error(`Failed to add route: ${JSON.stringify(resp.data)}`)
				}
			}
		}
	}
}

export async function onDel(str: string | undefined) {
	const client = await getClient()
	const gateways = await getGateways(client)
	const routes = await getRoutes(client)

	if (str === undefined) {
		str = config.gwPrefix
	}

	const regex = new RegExp(str)

	for (let gw of gateways.filter((gw) => regex.test(gw.name))) {
		for (let route of routes.filter(route => route.gateway === `${gw.name} - ${gw.gateway}`)) {
			console.log(`Deleting route ${route.network} with gateway ${route.gateway}`)
			const resp = await client.routes.routesDelroute(route.uuid)
			if (resp.data.result !== 'deleted') {
				throw new Error(`Failed to delete gateway: ${JSON.stringify(resp.data)}`)
			}
		}
		console.log(`Deleting gateway ${gw.name}`)
		const resp = await client.routing.settingsDelGateway(gw.uuid)
		if (resp.data.result !== 'deleted') {
			throw new Error(`Failed to delete gateway: ${JSON.stringify(resp.data)}`)
		}
	}
}

export async function waitForGateways(ips: string[]) {
	const client = await getClient()
	for (let ip of ips) {
		let gateways = await getGateways(client)

		let found = gateways.filter(gw => gw.gateway === ip)
		if (found.length < 1) {
			throw Error(`Couldn't find gateway with IP ${ip}`)
		}

		while (true) {
			const foundGw = found[0]
			if (foundGw.status === "Online") {
				break
			}
			console.log(`Gateway is offline, waiting 1 second (${foundGw.loss} loss)`)
			await sleep(1000)
			gateways = await getGateways(client)
			found = gateways.filter(gw => gw.uuid === foundGw.uuid)
		}
	}
}

if (import.meta.main) {
	const cli = new Command()
	cli
		.name('opnsense')
		.description('Configure, enable, and disable opnsense routes and gateways')
		.version('0.1.0')

	cli.command('up')
		.argument('[route]')
		.action(onUp)
	cli.command('down')
		.argument('[route]')
		.action(onDown)

	cli.command('add')
		.action(onAdd)

	cli.command('del')
		.argument('[regex]')
		.action(onDel)

	await cli.parseAsync()
}
