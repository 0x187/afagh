package app

import (
	"net/http"
	"net/http/httputil"
	"net/url"
)

// newHostPreservingProxy proxies to the SPA dev server (Vite) while keeping
// the original Host header, which Vite/HMR need.
func newHostPreservingProxy(u *url.URL) http.Handler {
	p := &httputil.ReverseProxy{Rewrite: func(req *httputil.ProxyRequest) {
		req.SetURL(u)
		req.Out.Host = u.Host
	}}
	return p
}
