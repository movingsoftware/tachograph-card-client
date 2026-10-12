const supportedTargets = new Set([
    'aarch64-apple-darwin',
    'x86_64-apple-darwin',
    'x86_64-pc-windows-msvc',
    'x86_64-unknown-linux-gnu',
])
const supportedBundles = new Set(['app', 'dmg', 'appimage', 'nsis'])

export function parseReleaseBuildArguments(argumentsList) {
    const forwardedArguments = []
    const seen = new Set()
    for (let index = 0; index < argumentsList.length; index += 1) {
        const argument = argumentsList[index]
        if (argument === '--target' || argument === '--bundles') {
            const value = argumentsList[index + 1]
            if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`)
            if (seen.has(argument)) throw new Error(`${argument} may be specified only once.`)
            validateArgument(argument, value)
            seen.add(argument)
            forwardedArguments.push(argument, value)
            index += 1
            continue
        }
        const equalsIndex = argument.indexOf('=')
        const name = argument.slice(0, equalsIndex)
        if (equalsIndex > 0 && (name === '--target' || name === '--bundles')) {
            if (seen.has(name)) throw new Error(`${name} may be specified only once.`)
            const value = argument.slice(equalsIndex + 1)
            validateArgument(name, value)
            seen.add(name)
            forwardedArguments.push(name, value)
            continue
        }
        throw new Error(`Unsupported release build argument: ${argument}`)
    }
    return forwardedArguments
}

function validateArgument(name, value) {
    if (name === '--target' && !supportedTargets.has(value)) {
        throw new Error(`Unsupported release target: ${value}`)
    }
    if (name === '--bundles') {
        const bundles = value.split(',')
        if (!bundles.length || bundles.some((bundle) => !supportedBundles.has(bundle)) || new Set(bundles).size !== bundles.length) {
            throw new Error(`Unsupported release bundle format: ${value}`)
        }
    }
}
