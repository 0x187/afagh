// ═══ تنظیمات سامانه (ادمین) — پورت admin/settings ═══
package admin

import (
	"context"
	"errors"
	"strings"

	"backend-go/internal/session"
)

// SettingView نمای یک تنظیم.
type SettingView struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Default  string `json:"default"`
	Source   string `json:"source"` // DB | ENV | DEFAULT
	IsSecret bool   `json:"isSecret"`
}

// SettingsListResponse فهرست تنظیمات.
type SettingsListResponse struct {
	Settings []SettingView `json:"settings"`
}

// GetSettings فهرست کل تنظیمات با ماسک مقادیر محرمانه.
func (s *Service) GetSettings(ctx context.Context, user *session.User) (*SettingsListResponse, error) {
	if s.Store == nil {
		return nil, errors.New("مخزن تنظیمات در دسترس نیست.")
	}
	resp := &SettingsListResponse{Settings: []SettingView{}}
	for _, def := range s.Store.AllDefs() {
		value, err := s.Store.Get(ctx, def.Key)
		if err != nil {
			value = def.Default
		}
		source := "DEFAULT"
		if strings.TrimSpace(value) != "" && value != def.Default {
			source = "DB"
		}
		view := SettingView{Key: def.Key, Value: value, Default: def.Default, Source: source}
		if strings.Contains(strings.ToLower(def.Key), "secret") || strings.Contains(strings.ToLower(def.Key), "pepper") {
			view.IsSecret = true
			if value != "" {
				view.Value = "••••••••"
			}
		}
		resp.Settings = append(resp.Settings, view)
	}
	return resp, nil
}

// SaveSetting ذخیرهٔ یک تنظیم در دیتابیس.
func (s *Service) SaveSetting(ctx context.Context, user *session.User, key, value string) error {
	if s.Store == nil {
		return errors.New("مخزن تنظیمات در دسترس نیست.")
	}
	key = strings.TrimSpace(key)
	found := false
	for _, def := range s.Store.AllDefs() {
		if def.Key == key {
			found = true
			break
		}
	}
	if !found {
		return errors.New("تنظیم ناشناخته: " + key)
	}
	if strings.Contains(strings.ToLower(key), "secret") && strings.Contains(value, "•") {
		return errors.New("مقدار محرمانه را کامل وارد کنید یا خالی بگذارید.")
	}
	if err := s.Store.Save(ctx, key, strings.TrimSpace(value)); err != nil {
		return err
	}
	s.Store.Invalidate()
	return nil
}

// ResetSetting بازگشت به پیش‌فرض (حذف ردیف DB).
func (s *Service) ResetSetting(ctx context.Context, user *session.User, key string) error {
	if s.Store == nil {
		return errors.New("مخزن تنظیمات در دسترس نیست.")
	}
	if err := s.Store.Delete(ctx, strings.TrimSpace(key)); err != nil {
		return err
	}
	s.Store.Invalidate()
	return nil
}
