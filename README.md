# tspmo
TypeScript ProxMox Orchestrator

## Running
First, build the vendored dependency on the opnsense client library with:
```bash
cd opnsense-typescript-client
yarn install
yarn build
```

Then install the dependencies for this repo:
```bash
npm i
```

Then add a .env file with your Proxmox and Opnsense credentials, ex:
```
OPNSENSE_BASE_URL=https://10.0.0.1
OPNSENSE_API_KEY=secret
OPNSENSE_API_SECRET=secret


PROXMOX_HOST=192.168.2.10
# User authentication
PROXMOX_USER=root@pam
PROXMOX_PASS='secret'
# Token authentication
PROXMOX_TOKEN_ID='user@pve!tokenid'
PROXMOX_TOKEN_SECRET='secret'
```

Add a `tspmo.config.mts` file (you can copy the sample at `tspmo.config.sample.mts` as a starter):
```ts
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
```

Then run the program:
```
# To clone and start VMs and create and start Opnsense routes
npm run clone up

# To destroy the VMs and delete the routes
npm run clone down

# View available commands
npm run clone help
```

To just interact with Opnsense routes, you can use `npm start`:
```
# Add gateways and routes to Opnsense
npm start add

# Set gateways as enabled
npm start up

# Set gateways and routes as enabled
npm start up true

# Set gateways as disabled
npm start down

# Set gateways and routes as disabled
npm start down true

# View available commands
npm start help
```

## Credits
- opnsense-typescript-client is created by Pixelworlds (https://github.com/Pixelworlds/opnsense-typescript-client)
- SPAM (https://github.com/jacobseunglee/SPAM) was a huge inspiration for this project
