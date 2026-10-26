// ═══ لینک امن برای href — پورت safe-url.ts ═══
//
// فقط مسیر نسبی تک‌اسلش (نه «//») یا https:// مجاز است؛ javascript:, data:,
// http:, protocol-relative و هر کاراکتر کنترلی/بک‌اسلش رد می‌شوند.
package safeurl

import (
	"regexp"
	"strings"
)

var controlOrBackslash = regexp.MustCompile("[\x00-\x1f\x7f\\\\]")
var httpsPattern = regexp.MustCompile(`(?i)^https://[^\s/?#]`)

// IsSafeLinkURL پورت isSafeLinkUrl.
func IsSafeLinkURL(s string) bool {
	if controlOrBackslash.MatchString(s) {
		return false
	}
	if strings.HasPrefix(s, "/") && !strings.HasPrefix(s, "//") {
		return true
	}
	return httpsPattern.MatchString(s)
}
