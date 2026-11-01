// ═══ Safe link for href — port of safe-url.ts ═══
//
// Only a single-slash relative path (not '//') or https:// is allowed; javascript:, data:,
// http:, protocol-relative, and any control character/backslash are rejected.
package safeurl

import (
	"regexp"
	"strings"
)

var controlOrBackslash = regexp.MustCompile("[\x00-\x1f\x7f\\\\]")
var httpsPattern = regexp.MustCompile(`(?i)^https://[^\s/?#]`)

// IsSafeLinkURL ports isSafeLinkUrl.
func IsSafeLinkURL(s string) bool {
	if controlOrBackslash.MatchString(s) {
		return false
	}
	if strings.HasPrefix(s, "/") && !strings.HasPrefix(s, "//") {
		return true
	}
	return httpsPattern.MatchString(s)
}
