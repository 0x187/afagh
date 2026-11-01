package app

import (
	"context"

	"backend-go/internal/admin"
	"backend-go/internal/settings"
)

// settingsStoreAdapter adapts *settings.Store to the interface the admin
// package declares (avoids an import cycle between admin and settings).
type settingsStoreAdapter struct {
	store *settings.Store
}

func (a *settingsStoreAdapter) Get(ctx context.Context, key string) (string, error) {
	return a.store.Get(ctx, key)
}

func (a *settingsStoreAdapter) Save(ctx context.Context, key, value string) error {
	return a.store.Save(ctx, key, value)
}

func (a *settingsStoreAdapter) Delete(ctx context.Context, key string) error {
	return a.store.Delete(ctx, key)
}

func (a *settingsStoreAdapter) AllDefs() []admin.SettingsDef {
	defs := a.store.AllDefs()
	out := make([]admin.SettingsDef, 0, len(defs))
	for _, d := range defs {
		out = append(out, admin.SettingsDef{Key: d.Key, Env: d.Env, Default: d.Default, EnvOnly: d.EnvOnly})
	}
	return out
}

func (a *settingsStoreAdapter) Invalidate() {
	a.store.Invalidate()
}
