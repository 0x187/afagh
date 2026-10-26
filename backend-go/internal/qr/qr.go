// ═══ تولید QR برداری — پورت src/lib/qr.ts (بخش qrSvg) ═══
//
// همان قرارداد خروجی: SVG با viewBox، حاشیهٔ سکوت ۴ ماژول، سطح تصحیح خطای Q
// و رنگ سرمه‌ای تیره. عرض/ارتفاع صریح گذاشته می‌شود تا در چاپ کوچک نشود.
package qr

import (
	"fmt"
	"strings"

	qrcode "github.com/skip2/go-qrcode"
)

// Options گزینه‌های تولید.
type Options struct {
	// Level سطح تصحیح خطا: L|M|Q|H — پیش‌فرض Q.
	Level string
	// Margin ماژول حاشیهٔ سکوت — پیش‌فرض ۴.
	Margin int
	// Size عرض/ارتفاع صریح SVG — پیش‌فرض ۱۶۰.
	Size int
}

// SVG تولید SVG از متن. متن خالی با یک فاصله جایگزین می‌شود (قرارداد TS).
func SVG(text string, opt Options) (string, error) {
	if text == "" {
		text = " "
	}
	level := qrcode.Medium
	switch strings.ToUpper(strings.TrimSpace(opt.Level)) {
	case "L":
		level = qrcode.Low
	case "M":
		level = qrcode.Medium
	case "H":
		level = qrcode.Highest
	case "Q", "":
		level = qrcode.High
	}
	margin := opt.Margin
	if margin < 0 {
		margin = 0
	}
	if opt.Margin == 0 {
		margin = 4
	}
	size := opt.Size
	if size <= 0 {
		size = 160
	}

	code, err := qrcode.New(text, level)
	if err != nil {
		return "", err
	}
	code.DisableBorder = true
	bitmap := code.Bitmap()
	dim := len(bitmap)
	if dim == 0 {
		return "", fmt.Errorf("qr: empty bitmap")
	}
	full := dim + margin*2

	var b strings.Builder
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" shape-rendering="crispEdges">`, size, size, full, full)
	b.WriteString(`<rect width="100%" height="100%" fill="#ffffff"/>`)
	b.WriteString(`<path fill="#0f172a" d="`)
	for y, row := range bitmap {
		for x, dark := range row {
			if !dark {
				continue
			}
			fmt.Fprintf(&b, "M%d %dh1v1h-1z", x+margin, y+margin)
		}
	}
	b.WriteString(`"/></svg>`)
	return b.String(), nil
}
