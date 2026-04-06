import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'
import { getLocalLLMProvider, getLocalLLMProviderLabel } from '../../utils/model/providers.js'

const setup: Command = {
  type: 'local-jsx',
  name: 'setup',
  aliases: ['configure'],
  get description() {
    return `Configure model backend — provider, endpoint, model, and API key (currently ${getLocalLLMProviderLabel(getLocalLLMProvider())})`
  },
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./setup.js'),
}

export default setup
