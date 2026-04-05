import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'
import { getLocalLLMProvider, getLocalLLMProviderLabel } from '../../utils/model/providers.js'

export default {
  type: 'local-jsx',
  name: 'provider',
  get description() {
    return `Configure the local backend provider (currently ${getLocalLLMProviderLabel(getLocalLLMProvider())})`
  },
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./provider.js'),
} satisfies Command