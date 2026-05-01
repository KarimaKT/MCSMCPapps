/**
 * Public entry point for the handoff module.
 *
 * Customer integration in 4 lines once the broker is deployed:
 *
 *   import {
 *     HandoffOrchestrator,
 *     CustomWebhookProvider
 *   } from './handoff';
 *
 *   const orchestrator = new HandoffOrchestrator({
 *     provider: new CustomWebhookProvider({
 *       brokerBaseUrl: 'https://my-broker.azurewebsites.net',
 *       getAccessToken: () => acquireToken().then(r => r.token!)
 *     }),
 *     cs: {
 *       notifyHandoffPending: () => csClient.sendEvent({ name: 'handoffPending' }),
 *       resumeFromLive: (payload) => csClient.sendEvent({ name: 'resumeFromLive', value: payload })
 *     },
 *     hooks: {
 *       onSystemMessage: (text) => ui.appendSystem(text),
 *       onLiveInbound: (event) => ui.renderLiveEvent(event),
 *       onModeChange: (_, next) => ui.setBadge(next)
 *     }
 *   });
 *
 *   // Inbound from CS event-router:
 *   if (activity.type === 'event' && activity.name === 'handoff') {
 *     await orchestrator.beginHandoff(activity.value);
 *   }
 *
 *   // User send button:
 *   const handled = await orchestrator.routeUserMessage(text);
 *   if (!handled) await csClient.sendMessage(text);
 */
export { HandoffOrchestrator } from './HandoffOrchestrator';
export { CustomWebhookProvider } from './providers/custom';
export type {
  CopilotStudioBridge,
  HandoffContext,
  HandoffHooks,
  HandoffInbound,
  HandoffListener,
  HandoffMode,
  HandoffOrchestratorConfig,
  HandoffProvider,
  HandoffSession,
  HandoffTranscriptEntry,
  HandoffUser,
  Unsubscribe
} from './types';
