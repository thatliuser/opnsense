import ip from 'ipaddr.js'

function range(size: number, start: number): number[] {
	return [...Array(size).keys()].map(i => i + start)
}

export interface Config {
	nodes: string[]
	copies: number
	startVmid: number
	firstRouter: ip.IPv4
	gateway: ip.IPv4
	bridge: string
	startVlan: number
	templates: number[]
	gwPrefix: string
}

export const config: Config = {
	nodes: ['cuci-r730-pve03'],
	copies: 2,
	startVmid: 6800,
	firstRouter: new ip.IPv4([10, 189, 1, 1]),
	gateway: new ip.IPv4([10, 0, 0, 1]),
	bridge: 'vmbr3',
	startVlan: 500,
	// 6600 - 6609
	templates: range(10, 6600),
	gwPrefix: 'test-1'
}
