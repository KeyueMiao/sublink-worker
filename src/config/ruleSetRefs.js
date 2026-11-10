/**
 * Custom Rule Set References
 * A custom rule may point at a rule set by name (fetched from the built-in
 * repositories) or by full URL. Both need a stable tag, because emitted rules
 * only reference the tag while the definition side owns the URL.
 */

import { GITHUB_ACCELERATOR_PREFIX } from './ruleUrls.js';

const REMOTE_URL_PATTERN = /^https?:\/\//i;
const FILE_EXTENSION_PATTERN = /\.(?:srs|mrs|yaml|yml|json|txt|conf|list|text)$/i;
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com', 'raw.githubusercontent.com']);

export function isRemoteRuleSetUrl(value) {
	return typeof value === 'string' && REMOTE_URL_PATTERN.test(value.trim());
}

/**
 * Route a GitHub link through the built-in mirror. The rule keeps the URL the
 * user typed; only the generated config gets the mirrored one.
 */
export function withGithubAccelerator(url) {
	if (!isRemoteRuleSetUrl(url)) return url;
	const value = url.trim();
	if (value.startsWith(GITHUB_ACCELERATOR_PREFIX)) return value;
	try {
		if (!GITHUB_HOSTS.has(new URL(value).hostname.toLowerCase())) return value;
	} catch {
		return value;
	}
	return `${GITHUB_ACCELERATOR_PREFIX}${value}`;
}

// Tags become sing-box rule_set tags and Clash provider keys, so keep them to
// characters both clients accept.
export function ruleSetTagFromUrl(url) {
	const path = String(url).trim().split(/[?#]/)[0];
	const fileName = path.split('/').filter(Boolean).pop() || '';
	let decoded = fileName;
	try {
		decoded = decodeURIComponent(fileName);
	} catch {
		// Malformed escapes: keep the raw file name.
	}
	const tag = decoded
		.replace(FILE_EXTENSION_PATTERN, '')
		.replace(/[^\w.!~-]+/g, '-')
		.replace(/^[-.]+|-+$/g, '');
	return tag || 'rule-set';
}

export function singboxRuleSetFormat(url) {
	return /\.srs(?:$|[?#])/i.test(String(url).trim()) ? 'binary' : 'source';
}

export function clashRuleSetFormat(url) {
	const value = String(url).trim();
	if (/\.mrs(?:$|[?#])/i.test(value)) return 'mrs';
	if (/\.txt(?:$|[?#])/i.test(value)) return 'text';
	return 'yaml';
}

export function clashRuleSetExtension(url) {
	const match = String(url).trim().split(/[?#]/)[0].match(FILE_EXTENSION_PATTERN);
	return match ? match[0].toLowerCase() : '.yaml';
}

/**
 * One tag per distinct rule set source: the same URL used by several rules, or
 * a custom name shadowing a built-in set, must not produce duplicate tags.
 */
export function createRuleSetTagAllocator() {
	const sourceByTag = new Map();
	return (candidate, sourceKey) => {
		let tag = candidate;
		for (let suffix = 2; sourceByTag.has(tag); suffix += 1) {
			if (sourceByTag.get(tag) === sourceKey) return tag;
			tag = `${candidate}-${suffix}`;
		}
		sourceByTag.set(tag, sourceKey);
		return tag;
	};
}
