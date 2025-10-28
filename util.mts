export function throwIfUndefined(envVar: string | undefined): string {
	if (envVar === undefined) {
		throw new Error('Environment variable is undefined')
	} else {
		return envVar
	}
}

export async function sleep(ms: number) {
	await new Promise(resolve => setTimeout(resolve, ms))
}

