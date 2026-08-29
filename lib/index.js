/**
 * Cordis loader ticket so `dsh plugin add` accepts this package as a bundle.
 * Real activation is the Community v0.15 FacetModule in lib/host.js
 * (host facet) and lib/ui.js (browser facet), driven by @dsh-std/adapter-dsh.
 */
export const name = 'dsh-github-installer'

export function apply() {
  // No classic host behavior: the std adapter activates the facets.
}
