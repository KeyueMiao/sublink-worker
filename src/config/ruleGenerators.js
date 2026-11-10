/**
 * Rule Generators
 * Functions for generating rules and rule sets
 */

import { UNIFIED_RULES, PREDEFINED_RULE_SETS } from './rules.js';
import { SITE_RULE_SET_BASE_URL, IP_RULE_SET_BASE_URL, CLASH_SITE_RULE_SET_BASE_URL, CLASH_IP_RULE_SET_BASE_URL } from './ruleUrls.js';
import {
	clashRuleSetExtension,
	clashRuleSetFormat,
	createRuleSetTagAllocator,
	isRemoteRuleSetUrl,
	ruleSetTagFromUrl,
	singboxRuleSetFormat,
	withGithubAccelerator
} from './ruleSetRefs.js';

// Rule set names are interpolated into the download URL (`${BASE}${name}.srs`),
// so user-supplied names must stay within the charset upstream rule-set files
// use. Rejecting `..` keeps the name from escaping the base path (CWE-918).
const SAFE_RULE_ID_RE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

function isSafeRuleId(value) {
	return typeof value === 'string' && SAFE_RULE_ID_RE.test(value) && !value.includes('..');
}

// The Sing-Box DNS rules in the base configs resolve through these rule sets,
// so they must exist even when their routing rule is not selected.
const ALWAYS_PRESENT_SITE_RULE_SETS = ['geolocation-cn', 'cn', 'geolocation-!cn'];

function toStringArray(value) {
	if (Array.isArray(value)) {
		return value
			.filter(x => typeof x === 'string').map(x => x.trim())
			.filter(Boolean);
	}
	if (typeof value === 'string') {
		return value.split(',').map(x => x.trim()).filter(Boolean);
	}
	return [];
}

// A custom rule set entry is either a plain name from the default repository or
// a full URL. Names are sanitized; URLs are used as-is because they are never
// concatenated with a base URL.
function customRuleRuleSets(rule) {
	const accelerate = Boolean(rule?.accelerate);
	const resolve = entry => {
		if (isRemoteRuleSetUrl(entry)) {
			return accelerate ? withGithubAccelerator(entry) : entry.trim();
		}
		return isSafeRuleId(entry) ? entry : null;
	};
	return {
		site: toStringArray(rule?.site).map(resolve).filter(Boolean),
		ip: toStringArray(rule?.ip).map(resolve).filter(Boolean)
	};
}

function normalizeSelectedRules(selectedRules) {
	if (typeof selectedRules === 'string' && PREDEFINED_RULE_SETS[selectedRules]) {
		return PREDEFINED_RULE_SETS[selectedRules];
	}
	if (!selectedRules || selectedRules.length === 0) {
		return PREDEFINED_RULE_SETS.minimal;
	}
	return selectedRules;
}

// Helper function to get outbounds based on selected rule names
export function getOutbounds(selectedRuleNames) {
	if (!selectedRuleNames || !Array.isArray(selectedRuleNames)) {
		return [];
	}
	return UNIFIED_RULES
		.filter(rule => selectedRuleNames.includes(rule.name))
		.map(rule => rule.name);
}

/**
 * Resolve every rule set the output can reference in one pass. Rule lines and
 * rule set definitions both read their tags from here, so they can never refer
 * to different things.
 */
function buildRuleSetPlan(selectedRules, customRules) {
	const allocateTag = createRuleSetTagAllocator();
	const selectedRulesSet = new Set(selectedRules);
	const allCustomRules = Array.isArray(customRules) ? customRules : [];

	const tagFor = (entry, kind) => {
		const isUrl = isRemoteRuleSetUrl(entry);
		const baseTag = isUrl ? ruleSetTagFromUrl(entry) : entry;
		// IP rule sets carry the -ip suffix so they never collide with a site
		// rule set of the same name.
		const candidate = kind === 'ip' && !/-ip$/i.test(baseTag) ? `${baseTag}-ip` : baseTag;
		return allocateTag(candidate, isUrl ? `url:${entry.trim()}` : `name:${entry}`);
	};

	const siteTag = entry => tagFor(entry, 'site');
	const ipTag = entry => tagFor(entry, 'ip');

	const siteRuleSets = new Map();
	const ipRuleSets = new Map();
	// Rule sets that only exist because the base config references them; Clash
	// output skips them unless its own fallback needs one.
	const implicitSiteTags = new Set();

	const addSiteRuleSet = entry => {
		const tag = siteTag(entry);
		if (!siteRuleSets.has(tag)) {
			siteRuleSets.set(tag, entry);
		}
	};
	const addIpRuleSet = entry => {
		const tag = ipTag(entry);
		if (!ipRuleSets.has(tag)) {
			ipRuleSets.set(tag, entry);
		}
	};

	UNIFIED_RULES.forEach(rule => {
		if (!selectedRulesSet.has(rule.name)) return;
		rule.site_rules.forEach(addSiteRuleSet);
		rule.ip_rules.forEach(addIpRuleSet);
	});

	// Registered before custom entries so a custom URL whose file name matches
	// one of them gets a distinct tag instead of shadowing it.
	ALWAYS_PRESENT_SITE_RULE_SETS.forEach(entry => {
		const tag = siteTag(entry);
		if (siteRuleSets.has(tag)) return;
		siteRuleSets.set(tag, entry);
		implicitSiteTags.add(tag);
	});

	allCustomRules.forEach(rule => {
		const { site, ip } = customRuleRuleSets(rule);
		site.forEach(entry => {
			const tag = siteTag(entry);
			// A custom rule now references this set, so every output needs it.
			implicitSiteTags.delete(tag);
			if (!siteRuleSets.has(tag)) {
				siteRuleSets.set(tag, entry);
			}
		});
		ip.forEach(addIpRuleSet);
	});

	return { siteRuleSets, ipRuleSets, implicitSiteTags, siteTag, ipTag };
}

// Helper function to generate rules based on selected rule names
export function generateRules(selectedRules = [], customRules = []) {
	selectedRules = normalizeSelectedRules(selectedRules);
	const plan = buildRuleSetPlan(selectedRules, customRules);

	const rules = [];

	UNIFIED_RULES.forEach(rule => {
		if (selectedRules.includes(rule.name)) {
			rules.push({
				site_rules: rule.site_rules,
				site_rule_tags: rule.site_rules.map(plan.siteTag),
				ip_rules: rule.ip_rules,
				ip_rule_tags: rule.ip_rules.map(plan.ipTag),
				domain_suffix: rule?.domain_suffix,
				ip_cidr: rule?.ip_cidr,
				outbound: rule.name
			});
		}
	});

	// Custom rules win over built-in ones, in the order the user entered them
	// (clients stop at the first matching rule), so unshift from the end.
	const allCustomRules = Array.isArray(customRules) ? customRules : [];
	for (let index = allCustomRules.length - 1; index >= 0; index -= 1) {
		const rule = allCustomRules[index];
		const { site, ip } = customRuleRuleSets(rule);
		rules.unshift({
			site_rules: site,
			site_rule_tags: site.map(plan.siteTag),
			ip_rules: ip,
			ip_rule_tags: ip.map(plan.ipTag),
			domain_suffix: toStringArray(rule.domain_suffix),
			domain_keyword: toStringArray(rule.domain_keyword),
			ip_cidr: toStringArray(rule.ip_cidr),
			src_ip_cidr: toStringArray(rule.src_ip_cidr),
			protocol: toStringArray(rule.protocol),
			outbound: rule.name
		});
	}

	return rules;
}

export function generateRuleSets(selectedRules = [], customRules = []) {
	const plan = buildRuleSetPlan(normalizeSelectedRules(selectedRules), customRules);

	const toRuleSet = (tag, entry, baseUrl) => {
		const isUrl = isRemoteRuleSetUrl(entry);
		return {
			tag,
			type: 'remote',
			format: isUrl ? singboxRuleSetFormat(entry) : 'binary',
			url: isUrl ? entry.trim() : `${baseUrl}${entry}.srs`,
		};
	};

	const site_rule_sets = Array.from(plan.siteRuleSets, ([tag, entry]) => toRuleSet(tag, entry, SITE_RULE_SET_BASE_URL));
	const ip_rule_sets = Array.from(plan.ipRuleSets, ([tag, entry]) => toRuleSet(tag, entry, IP_RULE_SET_BASE_URL));

	return { site_rule_sets, ip_rule_sets };
}

// Generate rule sets for Clash using .mrs format
export function generateClashRuleSets(selectedRules = [], customRules = [], useMrs = true) {
	const plan = buildRuleSetPlan(normalizeSelectedRules(selectedRules), customRules);

	// Determine format based on client compatibility
	const format = useMrs ? 'mrs' : 'yaml';
	const ext = useMrs ? '.mrs' : '.yaml';

	const toRuleProvider = (tag, entry, baseUrl, behavior) => {
		const isUrl = isRemoteRuleSetUrl(entry);
		return {
			type: 'http',
			format: isUrl ? clashRuleSetFormat(entry) : format,
			behavior,
			url: isUrl ? entry.trim() : `${baseUrl}${entry}${ext}`,
			path: `./ruleset/${tag}${isUrl ? clashRuleSetExtension(entry) : ext}`,
			interval: 86400
		};
	};

	const site_rule_providers = {};
	plan.siteRuleSets.forEach((entry, tag) => {
		// geolocation-!cn still needs a provider here when Non-China is not
		// selected; the other implicit sets only exist for Sing-Box DNS.
		if (plan.implicitSiteTags.has(tag) && tag !== 'geolocation-!cn') return;
		site_rule_providers[tag] = toRuleProvider(tag, entry, CLASH_SITE_RULE_SET_BASE_URL, 'domain');
	});

	const ip_rule_providers = {};
	plan.ipRuleSets.forEach((entry, tag) => {
		ip_rule_providers[tag] = toRuleProvider(tag, entry, CLASH_IP_RULE_SET_BASE_URL, 'ipcidr');
	});

	return { site_rule_providers, ip_rule_providers };
}
