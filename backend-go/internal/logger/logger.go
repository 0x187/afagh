// ═══ Structured JSON logging — faithful port of afagh-next/src/lib/logger.ts ═══
//
// "one line = one JSON" with the same keys (level/time/app/env/msg) so the existing
// Loki/ELK monitoring works unchanged. Secret-masking coverage in phase 0 is not the same
// level as ts (full masking patterns are ported in phase 1 along with auth);
// until then the simple rule "sensitive keys are never logged" is observed.
package logger

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
)

func parseLevel(s string) Level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return LevelDebug
	case "warn":
		return LevelWarn
	case "error":
		return LevelError
	default:
		return LevelInfo
	}
}

func (l Level) String() string {
	switch l {
	case LevelDebug:
		return "debug"
	case LevelWarn:
		return "warn"
	case LevelError:
		return "error"
	default:
		return "info"
	}
}

type Fields map[string]any

type Logger struct {
	mu      sync.Mutex
	base    Fields
	min     Level
	pretty  bool
	app     string
	envName string
}

var std = New(Fields{"mod": "app"}, LevelInfo, false, "afagh", "development")

// Configure sets the global logger at startup.
func Configure(level, format, app, envName string) {
	pretty := format == "pretty" || (format == "" && envName != "production")
	std = New(Fields{}, parseLevel(level), pretty, app, envName)
}

// New creates a logger with the given base fields.
func New(base Fields, min Level, pretty bool, app, envName string) *Logger {
	if base == nil {
		base = Fields{}
	}
	cp := Fields{}
	for k, v := range base {
		cp[k] = v
	}
	return &Logger{base: cp, min: min, pretty: pretty, app: app, envName: envName}
}

// Child creates a child logger with extra fields (same meaning as createLogger().child).
func (l *Logger) Child(f Fields) *Logger {
	cp := Fields{}
	for k, v := range l.base {
		cp[k] = v
	}
	for k, v := range f {
		cp[k] = v
	}
	return &Logger{base: cp, min: l.min, pretty: l.pretty, app: l.app, envName: l.envName}
}

// For returns the global logger with the given module (equivalent to createLogger({mod: 'x'})).
func For(mod string) *Logger { return std.Child(Fields{"mod": mod}) }

func (l *Logger) write(level Level, msg string, fields Fields) {
	if level < l.min {
		return
	}
	rec := map[string]any{
		"level": level.String(),
		"time":  time.Now().UTC().Format(time.RFC3339Nano),
		"app":   l.app,
		"env":   l.envName,
		"msg":   msg,
	}
	for k, v := range l.base {
		rec[k] = v
	}
	for k, v := range fields {
		if _, exists := rec[k]; exists && k != "mod" {
			continue // The message-oriented base field takes precedence
		}
		rec[k] = v
	}
	var line string
	if l.pretty {
		line = fmt.Sprintf("%s %-5s %s", rec["time"], strings.ToUpper(level.String()), msg)
		if len(rec) > 5 {
			line += " " + marshal(rec)
		}
	} else {
		line = marshal(rec)
	}
	switch level {
	case LevelError:
		fmt.Fprintln(os.Stderr, line)
	case LevelWarn:
		fmt.Fprintln(os.Stderr, line)
	default:
		fmt.Println(line)
	}
}

func marshal(rec map[string]any) string {
	b, err := json.Marshal(rec)
	if err != nil {
		return fmt.Sprintf(`{"level":"error","msg":"logger_marshal_failed","err":%q}`, err.Error())
	}
	return string(b)
}

// MarshalSafe converts any value to safe JSON (for logging unusual fields).
func MarshalSafe(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(b)
}

func (l *Logger) Debug(msg string, f Fields) { l.write(LevelDebug, msg, f) }
func (l *Logger) Info(msg string, f Fields)  { l.write(LevelInfo, msg, f) }
func (l *Logger) Warn(msg string, f Fields)  { l.write(LevelWarn, msg, f) }
func (l *Logger) Error(msg string, f Fields) { l.write(LevelError, msg, f) }
