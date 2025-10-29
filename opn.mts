import OPNsenseClient from '@richard-stovall/opnsense-typescript-client'
import z from 'zod'
import { throwIfUndefined } from './util.mts'

export const Gateway = z.object({
	name: z.string(),
	disabled: z.boolean(),
	descr: z.string(),
	gateway: z.ipv4().optional(),
	uuid: z.string(),
	status: z.string(),
	delay: z.string(),
	stddev: z.string(),
	loss: z.string(),
})

export const Gateways = z.array(Gateway)

export const Route = z.object({
	uuid: z.string(),
	disabled: z.enum(['0', '1']),
	network: z.cidrv4(),
	gateway: z.string(),
})

export const Routes = z.array(Route)

export interface GatewayType {
	gateway_item: {
		data_length: '',
		defaultgw: '0' | '1',
		descr: string,
		disabled: '0' | '1',
		fargw: '0' | '1',
		force_down: '0' | '1',
		// IP address
		gateway: string,
		interface: 'lan' | 'wan'
		interval: '',
		ipprotocol: 'inet',
		latencyhigh: '',
		latencylow: '',
		loss_interval: '',
		losshigh: '',
		losslow: '',
		// IP address
		monitor: string
		monitor_disable: '0' | '1',
		monitor_noroute: '0' | '1',
		name: string,
		priority: '255',
		time_period: '',
		weight: '1',
	}
}

export interface RouteType {
	route: {
		descr: string,
		disabled: '0' | '1',
		gateway: string,
		// CIDR
		network: string,
	}
}

async function testConnection(client: OPNsenseClient): Promise<void> {
	const result = await client.testConnection()
	if (result.success !== true) {
		throw new Error(`Client test connection failed: ${result}`)
	}
}

export async function getClient(): Promise<OPNsenseClient> {
	const client = new OPNsenseClient({
		baseUrl: throwIfUndefined(process.env.OPNSENSE_BASE_URL),
		apiKey: throwIfUndefined(process.env.OPNSENSE_API_KEY),
		apiSecret: throwIfUndefined(process.env.OPNSENSE_API_SECRET),
		verifySsl: false,
	})
	testConnection(client)
	return client
}
