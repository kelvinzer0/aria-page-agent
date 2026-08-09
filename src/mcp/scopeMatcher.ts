export interface ScopeRule {
  enabled: boolean
  protocol?: string
  host?: string
  port?: string
  file?: string
}

export interface ScopeConfig {
  target?: {
    scope?: {
      advanced_mode?: boolean
      include?: ScopeRule[]
      exclude?: ScopeRule[]
    }
  }
}

export function isUrlInScope(urlStr: string, configStr: string): boolean {
  if (!configStr || !configStr.trim()) return true; // Default in scope if no config
  try {
    const config = JSON.parse(configStr) as ScopeConfig;
    const scope = config.target?.scope;
    if (!scope) return true;

    const url = new URL(urlStr);
    const protocol = url.protocol.replace(':', ''); // 'https'
    const host = url.hostname;
    let port = url.port;
    if (!port) {
      port = protocol === 'https' ? '443' : '80';
    }
    const file = url.pathname + url.search;

    const matchRule = (rule: ScopeRule) => {
      if (!rule.enabled) return false;
      
      const matchField = (fieldValue: string, pattern?: string) => {
        if (!pattern) return true; // if not specified, it matches
        try {
          return new RegExp(pattern).test(fieldValue);
        } catch (e) {
          return false;
        }
      };

      return matchField(protocol, rule.protocol) &&
             matchField(host, rule.host) &&
             matchField(port, rule.port) &&
             matchField(file, rule.file);
    };

    // If advanced_mode is false or not set, default to true unless excluded?
    // Usually, if there are includes, it must match at least one include, unless it matches an exclude.
    // If no includes are defined, everything is included unless excluded.
    let included = true;
    
    if (scope.include && scope.include.length > 0) {
      included = scope.include.some(matchRule);
    }
    
    if (scope.exclude && scope.exclude.length > 0) {
      const excluded = scope.exclude.some(matchRule);
      if (excluded) {
        included = false;
      }
    }
    
    return included;

  } catch (e) {
    // If invalid JSON, just return true
    return true;
  }
}
