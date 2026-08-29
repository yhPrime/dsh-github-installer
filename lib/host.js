/**
 * dsh-github-installer — std host facet (Community v0.15).
 *
 * Publishes the six `ghp:*` standard commands and the `manage_plugin` std
 * Tool. All execution lives in ./installer.js.
 *
 * Component activation runs as plugin initialization inside the adapter, not
 * inside a Cordis effect setup, so the facet body is plain Node.
 */
import { defineFacet } from '@dsh-std/sdk'
import {
  COMMAND_REFERENCE,
  TOOL_REFERENCE,
  commandResources,
  createCommandHandler,
  createToolHandler,
} from './installer.js'

function jsonResult(kind, payload) {
  return { kind, text: JSON.stringify(payload) }
}

const facet = defineFacet(
  async function activate(context) {
    // Publish every declared command's runtime handler (the manifest carries
    // the resources/specs; the adapter matches them by name).
    for (const resource of commandResources()) {
      context.extensions.publish(COMMAND_REFERENCE, resource.name, createCommandHandler(resource.name))
    }
    // Publish the model-visible management Tool.
    context.extensions.publish(TOOL_REFERENCE, 'manage_plugin', createToolHandler())
  },
  function deactivate(reason) {
    // All publications are revoked by the lifecycle on deactivation.
  },
  async function snapshot() {
    return {
      state: 'active',
      message: 'dsh-github-installer: 标准命令 ghp:* + 工具 manage_plugin（dsh-std Community v0.15）',
      extensions: [
        ...commandResources().map((resource) => ({
          apiVersion: COMMAND_REFERENCE.apiVersion,
          kind: COMMAND_REFERENCE.kind,
          name: resource.name,
          status: { state: 'available' },
        })),
        {
          apiVersion: TOOL_REFERENCE.apiVersion,
          kind: TOOL_REFERENCE.kind,
          name: 'manage_plugin',
          status: { state: 'available' },
        },
      ],
    }
  },
)

export const stdFacet = facet
export default facet
