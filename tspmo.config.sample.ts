import type { Config } from './config.mts'
import ip from 'ipaddr.js'

export default {
	nodes: ['cuci-r730-pve03'],
	copies: 5,
	startVmid: 6900,
	firstRouter: new ip.IPv4([10, 65, 1, 1]),
	gateway: new ip.IPv4([10, 0, 0, 1]),
	bridge: 'vmbr3',
	startVlan: 500,
	templates: [6600, 6601, 6602],
	gwPrefix: 'my-network'
} satisfies Config
