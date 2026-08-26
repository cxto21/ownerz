const MIN_PQ_VERSIONS = { chromium: 124, firefox: 132, safari: 18 }

export function parseMajor(version) {
  const m = String(version || '').match(/\d+/)
  return m ? parseInt(m[0], 10) : null
}

function fromUserAgent(ua) {
  let m
  if ((m = ua.match(/(?:Edg|Chromium|Chrome)\/(\d+)/))) return { brand: 'chromium', major: parseInt(m[1], 10) }
  if ((m = ua.match(/Firefox\/(\d+)/)) || (m = ua.match(/rv:(\d+)/))) return { brand: 'firefox', major: parseInt(m[1], 10) }
  if ((m = ua.match(/Version\/(\d+)(?:\.\d+)*\s+(?:Mobile\/\w+\s+)?Safari/))) return { brand: 'safari', major: parseInt(m[1], 10) }
  return { brand: null, major: null }
}

async function chromiumBrandMajor() {
  if (!navigator.userAgentData?.getHighEntropyValues) return null
  try {
    const { fullVersionList = [] } = await navigator.userAgentData.getHighEntropyValues(['fullVersionList'])
    const pick =
      fullVersionList.find((b) => /edge/i.test(b.brand)) ||
      fullVersionList.find((b) => /chrome|chromium|brave|opera/i.test(b.brand))
    return pick ? parseMajor(pick.version) : null
  } catch {
    return null
  }
}

// Returns 'supported' | 'unsupported' | 'unknown'.
// Inference only: browsers cannot expose the negotiated TLS key exchange to JS.
// Thresholds are the versions that enabled X25519MLKEM768 by default against Cloudflare.
export async function getPqcCapability() {
  if (typeof navigator === 'undefined') return 'unknown'
  let brand = null
  let major = await chromiumBrandMajor()
  if (major == null) {
    const r = fromUserAgent(navigator.userAgent || '')
    brand = r.brand
    major = r.major
  } else {
    brand = 'chromium'
  }
  const min = brand ? MIN_PQ_VERSIONS[brand] : null
  if (min == null || major == null) return 'unknown'
  return major >= min ? 'supported' : 'unsupported'
}
