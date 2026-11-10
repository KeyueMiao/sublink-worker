/**
 * Rule Set Base URLs
 * Contains base URLs for different rule set providers
 */

// GitHub is not directly reachable from some networks, so every GitHub link
// the generated config points at goes through this mirror.
export const GITHUB_ACCELERATOR_PREFIX = 'https://gh-proxy.com/';

export const SITE_RULE_SET_BASE_URL = `${GITHUB_ACCELERATOR_PREFIX}https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/sing/geo/geosite/`;
export const IP_RULE_SET_BASE_URL = `${GITHUB_ACCELERATOR_PREFIX}https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/sing/geo/geoip/`;
export const CLASH_SITE_RULE_SET_BASE_URL = `${GITHUB_ACCELERATOR_PREFIX}https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geosite/`;
export const CLASH_IP_RULE_SET_BASE_URL = `${GITHUB_ACCELERATOR_PREFIX}https://github.com/MetaCubeX/meta-rules-dat/raw/refs/heads/meta/geo/geoip/`;
export const SURGE_SITE_RULE_SET_BASEURL = `${GITHUB_ACCELERATOR_PREFIX}https://github.com/NSZA156/surge-geox-rules/raw/refs/heads/release/geo/geosite/`
export const SURGE_IP_RULE_SET_BASEURL = `${GITHUB_ACCELERATOR_PREFIX}https://github.com/NSZA156/surge-geox-rules/raw/refs/heads/release/geo/geoip/`
