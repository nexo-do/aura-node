export { Aura } from './client.js'
export type { AuraOptions, RequestOptions } from './client.js'
export { AuraError } from './errors.js'
export type { AuraErrorType } from './errors.js'
export { verifyWebhook, isValidWebhook } from './webhooks.js'
export type { WebhookHeaders, VerifyOptions } from './webhooks.js'
export { Vouchers } from './resources/vouchers.js'
export type { IssueOptions, IssueAndWaitOptions } from './resources/vouchers.js'
export { Clients, Sequences } from './resources/clients.js'
export { Webhooks } from './resources/webhooks.js'
export * from './types.js'

import { Aura } from './client.js'
export default Aura
