import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { generateRules, generateRuleSets, generateClashRuleSets } from '../src/config/ruleGenerators.js';
import { SITE_RULE_SET_BASE_URL, IP_RULE_SET_BASE_URL, SURGE_SITE_RULE_SET_BASEURL, GITHUB_ACCELERATOR_PREFIX } from '../src/config/index.js';
import { ClashConfigBuilder } from '../src/builders/ClashConfigBuilder.js';
import { SingboxConfigBuilder } from '../src/builders/SingboxConfigBuilder.js';
import { SurgeConfigBuilder } from '../src/builders/SurgeConfigBuilder.js';

const INPUT = [
    'ss://YWVzLTI1Ni1nY206dGVzdA==@us1.example.com:8388#US-Node-1',
    'ss://YWVzLTI1Ni1nY206dGVzdA==@uk1.example.com:8388#UK-Node-1'
].join('\n');

const SITE_URL = 'https://rules.example.com/my-sites.srs';
const IP_URL = 'https://rules.example.com/my-ips.srs';

describe('custom rule sets: names and full URLs', () => {
    it('resolves a plain name against the default repository', () => {
        const { site_rule_sets, ip_rule_sets } = generateRuleSets('minimal', [
            { name: 'MyRule', site: 'my-sites', ip: 'my-ips' }
        ]);

        expect(site_rule_sets).toContainEqual({
            tag: 'my-sites',
            type: 'remote',
            format: 'binary',
            url: `${SITE_RULE_SET_BASE_URL}my-sites.srs`
        });
        expect(ip_rule_sets).toContainEqual({
            tag: 'my-ips-ip',
            type: 'remote',
            format: 'binary',
            url: `${IP_RULE_SET_BASE_URL}my-ips.srs`
        });
    });

    it('uses a full URL as given for Sing-Box', () => {
        const { site_rule_sets, ip_rule_sets } = generateRuleSets('minimal', [
            { name: 'MyRule', site: SITE_URL, ip: IP_URL }
        ]);

        expect(site_rule_sets).toContainEqual({ tag: 'my-sites', type: 'remote', format: 'binary', url: SITE_URL });
        expect(ip_rule_sets).toContainEqual({ tag: 'my-ips-ip', type: 'remote', format: 'binary', url: IP_URL });
    });

    it('detects the source format of a non-binary Sing-Box rule set', () => {
        const { site_rule_sets } = generateRuleSets('minimal', [
            { name: 'MyRule', site: 'https://rules.example.com/my-sites.json' }
        ]);

        expect(site_rule_sets).toContainEqual({
            tag: 'my-sites',
            type: 'remote',
            format: 'source',
            url: 'https://rules.example.com/my-sites.json'
        });
    });

    it('infers the Clash provider format from the URL extension', () => {
        const { site_rule_providers, ip_rule_providers } = generateClashRuleSets('minimal', [
            { name: 'MyRule', site: 'https://rules.example.com/my-sites.yaml', ip: 'https://rules.example.com/my-ips.mrs' }
        ], true);

        expect(site_rule_providers['my-sites']).toMatchObject({
            format: 'yaml',
            behavior: 'domain',
            url: 'https://rules.example.com/my-sites.yaml',
            path: './ruleset/my-sites.yaml'
        });
        expect(ip_rule_providers['my-ips-ip']).toMatchObject({
            format: 'mrs',
            behavior: 'ipcidr',
            url: 'https://rules.example.com/my-ips.mrs',
            path: './ruleset/my-ips-ip.mrs'
        });
    });

    it('keeps the default .mrs/.yaml providers for plain names', () => {
        const { site_rule_providers } = generateClashRuleSets('minimal', [{ name: 'MyRule', site: 'my-sites' }], false);

        expect(site_rule_providers['my-sites']).toMatchObject({
            format: 'yaml',
            behavior: 'domain',
            url: expect.stringContaining('/my-sites.yaml')
        });
    });

    it('references the rule set tag from the emitted rule', () => {
        const rules = generateRules('minimal', [{ name: 'MyRule', site: SITE_URL, ip: IP_URL }]);
        const customRule = rules.find(rule => rule.outbound === 'MyRule');

        expect(customRule.site_rules).toEqual([SITE_URL]);
        expect(customRule.site_rule_tags).toEqual(['my-sites']);
        expect(customRule.ip_rule_tags).toEqual(['my-ips-ip']);
    });

    it('shares one rule set when two rules use the same URL', () => {
        const customRules = [
            { name: 'Rule A', site: SITE_URL },
            { name: 'Rule B', site: SITE_URL }
        ];
        const { site_rule_sets } = generateRuleSets('minimal', customRules);
        const rules = generateRules('minimal', customRules);

        expect(site_rule_sets.filter(ruleSet => ruleSet.url === SITE_URL)).toHaveLength(1);
        expect(rules.find(rule => rule.outbound === 'Rule A').site_rule_tags).toEqual(['my-sites']);
        expect(rules.find(rule => rule.outbound === 'Rule B').site_rule_tags).toEqual(['my-sites']);
    });

    it('does not collapse a custom URL onto a built-in rule set with the same file name', () => {
        const { site_rule_sets } = generateRuleSets(['Google'], [
            { name: 'MyGoogle', site: 'https://rules.example.com/google.srs' }
        ]);
        const tags = site_rule_sets.map(ruleSet => ruleSet.tag);

        expect(new Set(tags).size).toBe(tags.length);
        expect(tags).toContain('google');
        expect(tags).toContain('google-2');

        const rules = generateRules(['Google'], [{ name: 'MyGoogle', site: 'https://rules.example.com/google.srs' }]);
        expect(rules.find(rule => rule.outbound === 'MyGoogle').site_rule_tags).toEqual(['google-2']);
        expect(rules.find(rule => rule.outbound === 'Google').site_rule_tags).toEqual(['google']);
    });

    it('keeps custom rule order and leaves the input array untouched', () => {
        const customRules = [
            { name: 'Rule A', site: 'site-a' },
            { name: 'Rule B', site: 'site-b' }
        ];

        generateRules('minimal', customRules);
        expect(customRules.map(rule => rule.name)).toEqual(['Rule A', 'Rule B']);

        const rules = generateRules('minimal', customRules);
        const customOutbounds = rules.map(rule => rule.outbound).filter(name => name.startsWith('Rule '));
        expect(customOutbounds).toEqual(['Rule A', 'Rule B']);
    });

    it('builds a valid Sing-Box config with unique rule set tags', async () => {
        const customRules = [{ name: 'MyRule', site: SITE_URL }];
        const builder = new SingboxConfigBuilder(INPUT, 'minimal', customRules, null, 'zh-CN', 'sing-box/1.13');

        await builder.build();

        const tags = builder.config.route.rule_set.map(ruleSet => ruleSet.tag);
        expect(new Set(tags).size).toBe(tags.length);

        const customRuleSet = builder.config.route.rule_set.find(ruleSet => ruleSet.tag === 'my-sites');
        expect(customRuleSet.url).toBe(SITE_URL);
        expect(builder.config.route.rules.some(rule => (rule.rule_set || []).includes('my-sites'))).toBe(true);
    });

    it('builds a Clash config whose rule references the custom provider', async () => {
        const customRules = [{ name: 'MyRule', site: SITE_URL }];
        const builder = new ClashConfigBuilder(INPUT, 'minimal', customRules, null, 'zh-CN', 'mihomo/1.0');

        const config = yaml.load(await builder.build());

        expect(config['rule-providers']['my-sites'].url).toBe(SITE_URL);
        expect(config.rules).toContain('RULE-SET,my-sites,MyRule');
    });

    it('emits a Surge rule with the URL as given, and the repository URL for names', async () => {
        const withUrl = new SurgeConfigBuilder(INPUT, 'minimal', [{ name: 'MyRule', site: SITE_URL }], null, 'zh-CN', 'surge/5');
        const withName = new SurgeConfigBuilder(INPUT, 'minimal', [{ name: 'MyRule', site: 'my-sites' }], null, 'zh-CN', 'surge/5');

        expect(await withUrl.build()).toContain(`RULE-SET,${SITE_URL},MyRule`);
        expect(await withName.build()).toContain(`RULE-SET,${SURGE_SITE_RULE_SET_BASEURL}my-sites.conf,MyRule`);
    });

    it('keeps the implicit Non-China rule set available', () => {
        const { site_rule_sets } = generateRuleSets([], []);

        expect(site_rule_sets).toContainEqual(expect.objectContaining({ tag: 'geolocation-!cn' }));
    });
});

describe('custom rule sets: GitHub mirror switch', () => {
    const GITHUB_SITE_URL = 'https://github.com/me/rules/raw/main/sites.srs';
    const GITHUB_IP_URL = 'https://raw.githubusercontent.com/me/rules/main/ips.srs';

    it('is off by default, so the URL is used as is', () => {
        const { site_rule_sets } = generateRuleSets('minimal', [{ name: 'MyRule', site: GITHUB_SITE_URL }]);

        expect(site_rule_sets).toContainEqual(expect.objectContaining({ tag: 'sites', url: GITHUB_SITE_URL }));
    });

    it('mirrors GitHub links when enabled, keeping the tag', () => {
        const { site_rule_sets, ip_rule_sets } = generateRuleSets('minimal', [
            { name: 'MyRule', site: GITHUB_SITE_URL, ip: GITHUB_IP_URL, accelerate: true }
        ]);

        expect(site_rule_sets).toContainEqual(expect.objectContaining({
            tag: 'sites',
            url: `${GITHUB_ACCELERATOR_PREFIX}${GITHUB_SITE_URL}`
        }));
        expect(ip_rule_sets).toContainEqual(expect.objectContaining({
            tag: 'ips-ip',
            url: `${GITHUB_ACCELERATOR_PREFIX}${GITHUB_IP_URL}`
        }));
    });

    it('leaves non-GitHub links and names untouched', () => {
        const { site_rule_sets } = generateRuleSets('minimal', [
            { name: 'MyRule', site: `${SITE_URL},my-sites`, accelerate: true }
        ]);
        const custom = site_rule_sets.filter(ruleSet => ruleSet.tag === 'my-sites');

        expect(custom).toHaveLength(1);
        expect(custom[0].url).toBe(SITE_URL);
        expect(site_rule_sets.some(ruleSet => ruleSet.url.endsWith('my-sites.srs'))).toBe(true);
    });

    it('does not mirror an already mirrored link twice', () => {
        const mirrored = `${GITHUB_ACCELERATOR_PREFIX}${GITHUB_SITE_URL}`;
        const { site_rule_sets } = generateRuleSets('minimal', [{ name: 'MyRule', site: mirrored, accelerate: true }]);

        expect(site_rule_sets.find(ruleSet => ruleSet.tag === 'sites').url).toBe(mirrored);
    });

    it('applies to Clash and Surge output too', async () => {
        const customRules = [{ name: 'MyRule', site: GITHUB_SITE_URL, accelerate: true }];
        const mirroredUrl = `${GITHUB_ACCELERATOR_PREFIX}${GITHUB_SITE_URL}`;

        const clash = new ClashConfigBuilder(INPUT, 'minimal', customRules, null, 'zh-CN', 'mihomo/1.0');
        const clashConfig = yaml.load(await clash.build());
        expect(clashConfig['rule-providers'].sites.url).toBe(mirroredUrl);

        const surge = new SurgeConfigBuilder(INPUT, 'minimal', customRules, null, 'zh-CN', 'surge/5');
        expect(await surge.build()).toContain(`RULE-SET,${mirroredUrl},MyRule`);
    });
});

