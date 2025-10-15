import OPNsenseClient from '@richard-stovall/opnsense-typescript-client'
import { getClient, Gateways, GatewayType, Routes, RouteType } from './opn.mts'
import { Command } from 'commander'
import z from 'zod'
import { readFile } from 'node:fs/promises'
import ip from 'ipaddr.js'
import 'dotenv/config'

const Config = z.object({
	prefix: z.string(),
	count: z.number().gt(0),
	firstRouter: z.ipv4()
})

async function getGateways(client: OPNsenseClient): Promise<z.infer<typeof Gateways>> {
	const gateways = await client.routing.settingsSearchGateway()
	if (gateways.data.rows !== undefined) {
		return Gateways.parse(gateways.data.rows)
	}
	throw new Error(`Failed to search gateways: ${gateways.data.message}`)
}

async function getRoutes(client: OPNsenseClient): Promise<z.infer<typeof Routes>> {
	const routes = await client.routes.routesSearchroute();
	if (routes.data.rows !== undefined) {
		return Routes.parse(routes.data.rows)
	}
	throw new Error(`Failed to search routes: ${routes.data.message}`)
}

async function getConfig(path: string): Promise<z.infer<typeof Config>> {
	const buffer = await readFile(path)
	const contents = buffer.toString('utf8')
	const json = JSON.parse(contents)
	return Config.parse(json)
}

async function onUpDown(up: boolean, route: boolean) {
	const caption = up ? 'up' : 'down'
	const disabled = up ? '0' : '1'
	const client = await getClient()
	const gateways = await getGateways(client)
	const routes = await getRoutes(client)
	const config = await getConfig('opn.json')

	let ipv4 = ip.parse(config.firstRouter)

	if (!(ipv4 instanceof ip.IPv4)) {
		throw new Error('IPv6 is not supported for now')
	}

	for (let i = 0; i < config.count; ++i) {
		const gatewayName = `${config.prefix}-gateway-${i}`
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
			const foundRoute = routes.find((route) => route.gateway.startsWith(gatewayName))
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
		ipv4 = ip.fromByteArray(bytes)
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

async function onUp(route: boolean | undefined) {
	route = route ?? false
	await onUpDown(true, route)
}

async function onDown(route: boolean | undefined) {
	route = route ?? false
	await onUpDown(false, route)
}

async function onAdd() {
	const client = await getClient()
	const gateways = await getGateways(client)
	const routes = await getRoutes(client)
	const config = await getConfig('opn.json')

	let ipv4 = ip.parse(config.firstRouter)
	if (!(ipv4 instanceof ip.IPv4)) {
		throw new Error('IPv6 is not supported for now')
	}

	const addedGateways: [string, string][] = []
	for (let i = 0; i < config.count; ++i) {
		const gatewayName = `${config.prefix}-gateway-${i}`
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
		ipv4 = ip.fromByteArray(bytes)
	}

	for (const [gw, cidr] of addedGateways) {
		if (!routes.find((route) => route.gateway.startsWith(gw))) {
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
			if (resp.data.result !== 'saved') {
				throw new Error(`Failed to add route: ${JSON.stringify(resp.data)}`)
			}
		}
	}
}

async function onDel(str: string | undefined) {
	const client = await getClient()
	const gateways = await getGateways(client)
	const routes = await getRoutes(client)
	const config = await getConfig('opn.json')

	if (str === undefined) {
		str = config.prefix
	}

	const regex = new RegExp(str)

	for (let gw of gateways.filter((gw) => regex.test(gw.name))) {
		for (let route of routes.filter(route => route.gateway.startsWith(gw.name))) {
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
