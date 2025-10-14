# opnsense

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

Then add a .env file with your opnsense credentials, ex:
```
OPNSENSE_BASE_URL=https://10.0.0.1
OPNSENSE_API_KEY=secret
OPNSENSE_API_SECRET=secret
```

Then run the program:
```
npm start add
npm start up

npm start down
npm start del <regex>
```

## Credits
opnsense-typescript-client is created by Pixelworlds (https://github.com/Pixelworlds/opnsense-typescript-client)
