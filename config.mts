import ip from 'ipaddr.js'

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
