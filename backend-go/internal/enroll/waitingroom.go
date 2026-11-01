// ═══ Redis waiting room — port of lib/waitingRoom.ts (faithful to the keys and Lua) ═══
package enroll

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// Keys keys shared with the current system — changing them breaks the queue/capacity between the two systems.
const (
	KeyCaps   = "afagh:caps"
	KeyQueue  = "afagh:wr:queue"
	wlKeyPfx  = "afagh:offering:"
	latestPfx = "afagh:wr:latest:"
	rlKeyPfx  = "afagh:rl:submit:"
)

// SeatLua the same atomic seat script — 1=seat, 0=full, -2=not warmed up.
const SeatLua = `
local v = redis.call('HGET', KEYS[1], ARGV[1])
if not v then return -2 end
local c, e, w = string.match(v, '(%d+),(%d+),(%d+)')
e = tonumber(e); c = tonumber(c)
if e < c then
  redis.call('HSET', KEYS[1], ARGV[1], c .. ',' .. (e + 1) .. ',' .. w)
  return 1
end
return 0`

// QueueTicket queue ticket.
type QueueTicket struct {
	ID                string `json:"id"`
	UserID            int64  `json:"userId"`
	StudentID         int64  `json:"studentId"`
	EnqueuedAt        int64  `json:"enqueuedAt"`
	AcceptSameDayRisk bool   `json:"acceptSameDayRisk,omitempty"`
}

// WrStatus user queue status.
type WrStatus struct {
	State    string `json:"state"`
	Position int    `json:"position,omitempty"`
	Result   any    `json:"result,omitempty"`
}

// WaitingRoom waiting room service.
type WaitingRoom struct {
	Pool *Pool
	RDB  *redis.Client

	workerOnce sync.Once
	stop       chan struct{}
}

// NewWaitingRoom service constructor.
func NewWaitingRoom(pool *Pool, rdb *redis.Client) *WaitingRoom {
	return &WaitingRoom{Pool: pool, RDB: rdb, stop: make(chan struct{})}
}

func randomTicketID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func wlKey(offeringID int64) string { return wlKeyPfx + strconv.FormatInt(offeringID, 10) + ":wl" }
func latestKey(userID int64) string { return latestPfx + strconv.FormatInt(userID, 10) }
func rlKey(userID int64) string     { return rlKeyPfx + strconv.FormatInt(userID, 10) }

func (w *WaitingRoom) available() bool { return w != nil && w.RDB != nil }

// WarmupCapacities port of warmupCapacities — transfer current-term capacity to Redis.
func (w *WaitingRoom) WarmupCapacities(ctx context.Context, force bool) int {
	if !w.available() {
		return 0
	}
	exists, err := w.RDB.Exists(ctx, KeyCaps).Result()
	if err != nil {
		return 0
	}
	if exists > 0 && !force {
		n, _ := w.RDB.HLen(ctx, KeyCaps).Result()
		return int(n)
	}
	var termID *int64
	_ = w.Pool.QueryRow(ctx, `select id from academic_terms where "isCurrent" = 1 order by id desc limit 1`).Scan(&termID)
	if termID == nil {
		return 0
	}
	rows, err := w.Pool.Query(ctx, `
		select id, capacity, "enrolledCount", coalesce("waitlistCapacity",0)
		  from course_offerings where "termId" = $1`, *termID)
	if err != nil {
		return 0
	}
	defer rows.Close()
	type capRow struct {
		id    int64
		cap   int
		enr   int
		waitC int
	}
	list := []capRow{}
	for rows.Next() {
		var r capRow
		if err := rows.Scan(&r.id, &r.cap, &r.enr, &r.waitC); err == nil {
			list = append(list, r)
		}
	}
	pipe := w.RDB.Pipeline()
	pipe.Del(ctx, KeyCaps)
	for _, r := range list {
		pipe.HSet(ctx, KeyCaps, strconv.FormatInt(r.id, 10),
			strconv.Itoa(r.cap)+","+strconv.Itoa(r.enr)+","+strconv.Itoa(r.waitC))
	}
	_, _ = pipe.Exec(ctx)
	return len(list)
}

// AtomicSeat port of atomicSeat.
func (w *WaitingRoom) AtomicSeat(ctx context.Context, offeringID int64) int {
	if !w.available() {
		return -2
	}
	res, err := w.RDB.Eval(ctx, SeatLua, []string{KeyCaps}, strconv.FormatInt(offeringID, 10)).Result()
	if err != nil {
		return -2
	}
	switch v := res.(type) {
	case int64:
		return int(v)
	case string:
		n, _ := strconv.Atoi(v)
		return n
	}
	return -2
}

// ReleaseSeat port of releaseSeat (floor zero).
func (w *WaitingRoom) ReleaseSeat(ctx context.Context, offeringID int64) {
	if !w.available() {
		return
	}
	v, err := w.RDB.HGet(ctx, KeyCaps, strconv.FormatInt(offeringID, 10)).Result()
	if err != nil || v == "" {
		return
	}
	parts := strings.Split(v, ",")
	if len(parts) != 3 {
		return
	}
	c, _ := strconv.Atoi(parts[0])
	e, _ := strconv.Atoi(parts[1])
	wc := parts[2]
	if e > 0 {
		e--
	}
	_ = w.RDB.HSet(ctx, KeyCaps, strconv.FormatInt(offeringID, 10),
		strconv.Itoa(c)+","+strconv.Itoa(e)+","+wc).Err()
}

// TakeSeat port of takeSeat.
func (w *WaitingRoom) TakeSeat(ctx context.Context, offeringID int64) {
	if !w.available() {
		return
	}
	v, err := w.RDB.HGet(ctx, KeyCaps, strconv.FormatInt(offeringID, 10)).Result()
	if err != nil || v == "" {
		return
	}
	parts := strings.Split(v, ",")
	if len(parts) != 3 {
		return
	}
	c, _ := strconv.Atoi(parts[0])
	e, _ := strconv.Atoi(parts[1])
	if e+1 > c {
		e = c
	} else {
		e++
	}
	_ = w.RDB.HSet(ctx, KeyCaps, strconv.FormatInt(offeringID, 10),
		strconv.Itoa(c)+","+strconv.Itoa(e)+","+parts[2]).Err()
}

// NextWaitlistPosition port of nextWaitlistPosition.
func (w *WaitingRoom) NextWaitlistPosition(ctx context.Context, offeringID int64) *int {
	if !w.available() {
		return nil
	}
	n, err := w.RDB.Incr(ctx, wlKey(offeringID)).Result()
	if err != nil {
		return nil
	}
	v := int(n)
	return &v
}

// Available port of redisAvailable.
func (w *WaitingRoom) Available(ctx context.Context) bool {
	if !w.available() {
		return false
	}
	ctx2, cancel := context.WithTimeout(ctx, 700*time.Millisecond)
	defer cancel()
	pong, err := w.RDB.Ping(ctx2).Result()
	return err == nil && pong == "PONG"
}

// EnqueueSubmit port of enqueueSubmit (ZADD + ZRANK).
func (w *WaitingRoom) EnqueueSubmit(ctx context.Context, userID, studentID int64, acceptSameDayRisk bool) (*QueueTicket, int, error) {
	ticket := QueueTicket{
		ID: randomTicketID(), UserID: userID, StudentID: studentID,
		EnqueuedAt: time.Now().UnixMilli(), AcceptSameDayRisk: acceptSameDayRisk,
	}
	raw, _ := json.Marshal(ticket)
	item := string(raw)
	if err := w.RDB.ZAdd(ctx, KeyQueue, redis.Z{Score: float64(ticket.EnqueuedAt), Member: item}).Err(); err != nil {
		return nil, 0, err
	}
	idx, err := w.RDB.ZRank(ctx, KeyQueue, item).Result()
	if err != nil {
		return nil, 0, err
	}
	position := int(idx) + 1
	latest, _ := json.Marshal(map[string]any{
		"item": item, "state": "WAITING", "enqueuedAt": ticket.EnqueuedAt, "position": position,
	})
	_ = w.RDB.Set(ctx, latestKey(userID), latest, 30*time.Minute).Err()
	return &ticket, position, nil
}

// QueuePosition port of queuePosition.
func (w *WaitingRoom) QueuePosition(ctx context.Context, item string) int {
	if !w.available() {
		return -1
	}
	idx, err := w.RDB.ZRank(ctx, KeyQueue, item).Result()
	if err != nil {
		return -1
	}
	return int(idx) + 1
}

// FinishTicket port of finishTicket.
func (w *WaitingRoom) FinishTicket(ctx context.Context, userID int64, ticketID string, result any) {
	if !w.available() {
		return
	}
	latest, _ := json.Marshal(map[string]any{"id": ticketID, "state": "DONE", "result": result})
	_ = w.RDB.Set(ctx, latestKey(userID), latest, 30*time.Minute).Err()
}

// MarkProcessing port of markProcessing.
func (w *WaitingRoom) MarkProcessing(ctx context.Context, userID int64, ticketID string) {
	if !w.available() {
		return
	}
	latest, _ := json.Marshal(map[string]any{"id": ticketID, "state": "PROCESSING"})
	_ = w.RDB.Set(ctx, latestKey(userID), latest, 30*time.Minute).Err()
}

// MyStatus port of myStatus.
func (w *WaitingRoom) MyStatus(ctx context.Context, userID int64) WrStatus {
	if !w.available() {
		return WrStatus{State: "IDLE"}
	}
	raw, err := w.RDB.Get(ctx, latestKey(userID)).Result()
	if err != nil || raw == "" {
		return WrStatus{State: "IDLE"}
	}
	var st struct {
		Item     string `json:"item"`
		State    string `json:"state"`
		Result   any    `json:"result"`
		Position int    `json:"position"`
	}
	if err := json.Unmarshal([]byte(raw), &st); err != nil {
		return WrStatus{State: "IDLE"}
	}
	if st.State == "DONE" {
		return WrStatus{State: "DONE", Result: st.Result}
	}
	pos := -1
	if st.Item != "" {
		pos = w.QueuePosition(ctx, st.Item)
	}
	if pos > 0 {
		return WrStatus{State: "WAITING", Position: pos}
	}
	return WrStatus{State: "PROCESSING"}
}

// RateLimitSubmit port of rateLimitSubmit — 5 requests per second; Redis down = open.
func (w *WaitingRoom) RateLimitSubmit(ctx context.Context, userID int64) bool {
	if !w.available() {
		return true
	}
	n, err := w.RDB.Incr(ctx, rlKey(userID)).Result()
	if err != nil {
		return true
	}
	if n == 1 {
		_ = w.RDB.Expire(ctx, rlKey(userID), time.Second).Err()
	}
	return n <= 5
}

// EnsureWorker runs the queue worker once per process (250ms / 10 items).
func (w *WaitingRoom) EnsureWorker(process func(ctx context.Context, userID, studentID int64, acceptSameDayRisk bool) any) {
	if !w.available() {
		return
	}
	w.workerOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(250 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-w.stop:
					return
				case <-ticker.C:
					for i := 0; i < 10; i++ {
						ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
						popped, err := w.RDB.ZPopMin(ctx, KeyQueue, 1).Result()
						if err != nil || len(popped) == 0 {
							cancel()
							break
						}
						item, ok := popped[0].Member.(string)
						if !ok {
							cancel()
							break
						}
						var t QueueTicket
						if err := json.Unmarshal([]byte(item), &t); err != nil {
							cancel()
							continue
						}
						w.MarkProcessing(ctx, t.UserID, t.ID)
						result := process(ctx, t.UserID, t.StudentID, t.AcceptSameDayRisk)
						w.FinishTicket(ctx, t.UserID, t.ID, result)
						cancel()
					}
				}
			}
		}()
	})
}

// StopWorker stops the worker (for tests/shutdown).
func (w *WaitingRoom) StopWorker() {
	select {
	case <-w.stop:
	default:
		close(w.stop)
	}
}

// CapacityInfo live capacity view of one offering.
type CapacityInfo struct {
	Cap       int `json:"cap"`
	Enrolled  int `json:"enrolled"`
	Remaining int `json:"remaining"`
}

// PeekCapacities port of peekCapacities.
func (w *WaitingRoom) PeekCapacities(ctx context.Context, offeringIDs []int64) map[int64]CapacityInfo {
	out := map[int64]CapacityInfo{}
	if !w.available() || len(offeringIDs) == 0 {
		return out
	}
	if exists, _ := w.RDB.Exists(ctx, KeyCaps).Result(); exists == 0 {
		w.WarmupCapacities(ctx, false)
	}
	keys := make([]string, len(offeringIDs))
	for i, id := range offeringIDs {
		keys[i] = strconv.FormatInt(id, 10)
	}
	vals, err := w.RDB.HMGet(ctx, KeyCaps, keys...).Result()
	if err != nil {
		return out
	}
	for i, raw := range vals {
		s, ok := raw.(string)
		if !ok || s == "" {
			continue
		}
		parts := strings.Split(s, ",")
		if len(parts) < 2 {
			continue
		}
		capN, _ := strconv.Atoi(parts[0])
		enr, _ := strconv.Atoi(parts[1])
		remaining := capN - enr
		if remaining < 0 {
			remaining = 0
		}
		out[offeringIDs[i]] = CapacityInfo{Cap: capN, Enrolled: enr, Remaining: remaining}
	}
	return out
}
