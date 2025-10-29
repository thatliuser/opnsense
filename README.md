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
PROXMOX_USER=root@pam
PROXMOX_PASS='secret'
```

Edit your config to your liking in `config.mts`:
```ts
export const config: Config = {
	nodes: ['cuci-r730-pve03'],
	copies: 5,
	startVmid: 6900,
	firstRouter: new ip.IPv4([10, 65, 1, 1]),
	gateway: new ip.IPv4([10, 0, 0, 1]),
	bridge: 'vmbr3',
	startVlan: 500,
	templates: [6600, 6601, 6602],
	gwPrefix: 'my-network'
}
```

Then run the program:
```
# To clone and start VMs and create and start Opnsense routes
npm run clone up

# To destroy the VMs and delete the routes
npm run clone down
```

## Credits
- opnsense-typescript-client is created by Pixelworlds (https://github.com/Pixelworlds/opnsense-typescript-client)
- SPAM (https://github.com/jacobseunglee/SPAM) was a huge inspiration for this project
