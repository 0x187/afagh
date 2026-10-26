package safeurl

import "testing"

func TestIsSafeLinkURL(t *testing.T) {
	cases := map[string]bool{
		"/": true, "/admin/settings": true, "/a/b?x=1#h": true,
		"//evil.com/x": false, "/a\\b": false,
		"https://example.com": true, "https://portal.saorg.ir/x?y=1": true,
		"HTTPS://EXAMPLE.COM": true, "https://": false, "https:///x": false,
		" https://example.com": false,
		"http://example.com":   false, "javascript:alert(1)": false,
		"JaVaScRiPt:alert(1)": false, "data:text/html,<script>": false,
		"mailto:a@b.com": false, "vbscript:msgbox": false,
		"/a\x00b": false, "/a\nb": false, "/a\tb": false,
		"https://exam\x7fple.com": false, "": false,
	}
	for in, want := range cases {
		if got := IsSafeLinkURL(in); got != want {
			t.Fatalf("IsSafeLinkURL(%q)=%v want %v", in, got, want)
		}
	}
}
