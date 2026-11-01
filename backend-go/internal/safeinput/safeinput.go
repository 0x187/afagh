// ═══ Upload and request form validation — port of safe-input.ts ═══
package safeinput

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// MaxUploadBytes is the 10 MB upload cap.
const MaxUploadBytes = 10 * 1024 * 1024

// SafeMIME is the allowed file-type whitelist.
var SafeMIME = map[string]bool{
	"image/jpeg": true, "image/png": true, "image/webp": true,
	"image/gif": true, "image/bmp": true, "application/pdf": true,
}

var extMIME = map[string][]string{
	"jpg":  {"image/jpeg"},
	"jpeg": {"image/jpeg"},
	"png":  {"image/png"},
	"webp": {"image/webp"},
	"gif":  {"image/gif"},
	"bmp":  {"image/bmp"},
	"pdf":  {"application/pdf"},
}

// MagicMatches validates magic bytes against the claimed MIME type.
func MagicMatches(mime string, b []byte) bool {
	if len(b) < 4 {
		return false
	}
	switch mime {
	case "image/jpeg":
		return b[0] == 0xFF && b[1] == 0xD8
	case "image/png":
		return b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47
	case "image/gif":
		return b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46
	case "application/pdf":
		return b[0] == 0x25 && b[1] == 0x50 && b[2] == 0x44 && b[3] == 0x46
	case "image/bmp":
		return b[0] == 0x42 && b[1] == 0x4D
	case "image/webp":
		return len(b) >= 12 &&
			b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46 &&
			b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50
	}
	return false
}

// UploadResult is the checkUpload result.
type UploadResult struct {
	OK     bool
	Mime   string
	Ext    string
	Status int
	Error  string
}

var nonAlnum = regexp.MustCompile(`[^a-z0-9]`)

// CheckUpload ports checkUpload: whitelist + magic bytes + extension match.
func CheckUpload(fileName, claimedType string, buf []byte) UploadResult {
	mime := strings.ToLower(claimedType)
	if mime == "" {
		mime = "application/octet-stream"
	}
	if !SafeMIME[mime] {
		return UploadResult{Status: 415, Error: "نوع فایل مجاز نیست (فقط تصویر یا PDF)."}
	}
	if !MagicMatches(mime, buf) {
		return UploadResult{Status: 400, Error: "محتوای فایل با نوع ادعاشده مطابقت ندارد."}
	}
	ext := ""
	if dot := strings.LastIndex(fileName, "."); dot >= 0 {
		ext = strings.ToLower(fileName[dot+1:])
	}
	ext = nonAlnum.ReplaceAllString(ext, "")
	if len(ext) > 8 {
		ext = ext[:8]
	}
	allowed := false
	for _, m := range extMIME[ext] {
		if m == mime {
			allowed = true
			break
		}
	}
	if !allowed {
		return UploadResult{Status: 400, Error: "پسوند فایل با نوع محتوا مطابقت ندارد."}
	}
	return UploadResult{OK: true, Mime: mime, Ext: ext}
}

// MaxFormKeys / MaxFormString are the request form caps.
const (
	MaxFormKeys   = 50
	MaxFormString = 2000
)

// FormAttachment is a form attachment (object key + metadata).
type FormAttachment struct {
	Key      string `json:"key"`
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	MimeType string `json:"mimeType"`
}

// SanitizeResult is the form sanitization result.
type SanitizeResult struct {
	OK    bool
	Data  map[string]any
	Error string
}

// SanitizeRequestFormData ports sanitizeRequestFormData: only plain values or
// an attachment whose key is inside that same student's folder.
func SanitizeRequestFormData(input json.RawMessage, studentID int64) SanitizeResult {
	bad := SanitizeResult{OK: false, Error: "داده‌های فرم نامعتبر است."}

	var root any
	if err := json.Unmarshal(input, &root); err != nil {
		return bad
	}
	obj, ok := root.(map[string]any)
	if !ok {
		return bad
	}
	if len(obj) > MaxFormKeys {
		return SanitizeResult{OK: false, Error: "تعداد فیلدهای فرم بیش از حد مجاز است."}
	}
	prefix := fmt.Sprintf("requests/%d/", studentID)
	isOwnKey := func(k any) bool {
		s, ok := k.(string)
		return ok && strings.HasPrefix(s, prefix) && !strings.Contains(s, "..")
	}
	data := make(map[string]any, len(obj))
	for k, v := range obj {
		if len(k) > 100 {
			return bad
		}
		if v == nil {
			data[k] = nil
			continue
		}
		switch val := v.(type) {
		case bool:
			data[k] = val
		case float64:
			// JSON gives all numbers as float64; equivalent to Number.isFinite
			data[k] = val
		case string:
			if len(val) > MaxFormString {
				return SanitizeResult{OK: false, Error: "یکی از مقادیر فرم بیش از حد طولانی است."}
			}
			if strings.HasPrefix(val, "requests/") && !isOwnKey(val) {
				return SanitizeResult{OK: false, Error: "پیوست نامعتبر است."}
			}
			data[k] = val
		case map[string]any:
			key, _ := val["key"].(string)
			if !isOwnKey(key) {
				return bad
			}
			att := FormAttachment{Key: key}
			if name, ok := val["name"].(string); ok {
				if len(name) > 255 {
					name = name[:255]
				}
				att.Name = name
			}
			if size, ok := val["size"].(float64); ok {
				att.Size = int64(size)
			}
			if mt, ok := val["mimeType"].(string); ok {
				if len(mt) > 100 {
					mt = mt[:100]
				}
				att.MimeType = mt
			}
			data[k] = att
		default:
			return bad
		}
	}
	return SanitizeResult{OK: true, Data: data}
}
