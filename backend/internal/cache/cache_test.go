package cache

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeClock lets the tests age the entries.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Add(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

func newStore() (*Store, *fakeClock) {
	clock := &fakeClock{now: time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)}
	s := New(5*time.Minute, 24*time.Hour, time.Minute)
	s.now = clock.Now
	return s, clock
}

// counter returns a fetch that counts its calls and answers "v<n>", after release is closed.
func counter(release <-chan struct{}) (FetchFunc, *int32) {
	var calls int32
	return func(ctx context.Context) ([]byte, error) {
		n := atomic.AddInt32(&calls, 1)
		<-release
		return []byte{'v', byte('0' + n)}, nil
	}, &calls
}

func mustGet(t *testing.T, s *Store, refresh bool, fetch FetchFunc) (string, State) {
	t.Helper()
	entry, state, err := s.Get(context.Background(), "k", refresh, fetch)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	return string(entry.Body), state
}

func TestConcurrentRequestsShareOneFetch(t *testing.T) {
	s, _ := newStore()
	release := make(chan struct{})
	fetch, calls := counter(release)

	var wg sync.WaitGroup
	bodies := make([]string, 10)
	for i := range bodies {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			entry, _, err := s.Get(context.Background(), "k", i%2 == 0, fetch) // refreshes too
			if err != nil {
				t.Errorf("Get: %v", err)
				return
			}
			bodies[i] = string(entry.Body)
		}(i)
	}
	time.Sleep(50 * time.Millisecond) // let every request join
	close(release)
	wg.Wait()

	if n := atomic.LoadInt32(calls); n != 1 {
		t.Fatalf("GitLab fetched %d times, want 1", n)
	}
	for _, body := range bodies {
		if body != "v1" {
			t.Fatalf("got %q, want v1", body)
		}
	}
}

func TestFreshThenStaleWhileRefreshing(t *testing.T) {
	s, clock := newStore()
	release := make(chan struct{})
	close(release)
	fetch, calls := counter(release)

	if body, state := mustGet(t, s, false, fetch); body != "v1" || state != Miss {
		t.Fatalf("first: %s %s", body, state)
	}
	clock.Add(4 * time.Minute)
	if body, state := mustGet(t, s, false, fetch); body != "v1" || state != Hit {
		t.Fatalf("fresh: %s %s", body, state)
	}

	// Older than 5 minutes: the old data right away, a refresh behind.
	clock.Add(2 * time.Minute)
	if body, state := mustGet(t, s, false, fetch); body != "v1" || state != Stale {
		t.Fatalf("stale: %s %s", body, state)
	}
	waitFor(t, func() bool {
		e, st, _ := s.Get(context.Background(), "k", false, fetch)
		return st == Hit && string(e.Body) == "v2"
	})
	if n := atomic.LoadInt32(calls); n != 2 {
		t.Fatalf("GitLab fetched %d times, want 2", n)
	}
}

func TestRefreshWaitsForNewData(t *testing.T) {
	s, _ := newStore()
	release := make(chan struct{})
	close(release)
	fetch, _ := counter(release)
	mustGet(t, s, false, fetch)
	if body, state := mustGet(t, s, true, fetch); body != "v2" || state != Miss {
		t.Fatalf("refresh: %s %s", body, state)
	}
}

func TestFetchOutlivesTheRequest(t *testing.T) {
	s, _ := newStore()
	release := make(chan struct{})
	fetch, calls := counter(release)

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(20 * time.Millisecond)
		cancel() // the user closes the tab
	}()
	if _, _, err := s.Get(ctx, "k", false, fetch); !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v, want context.Canceled", err)
	}
	close(release)

	// The fetch went on: the next request is served from the cache.
	waitFor(t, func() bool { _, st, _ := s.Get(context.Background(), "k", false, fetch); return st == Hit })
	if n := atomic.LoadInt32(calls); n != 1 {
		t.Fatalf("GitLab fetched %d times, want 1", n)
	}
}

func TestErrorsAreNotCached(t *testing.T) {
	s, _ := newStore()
	var calls int32
	fetch := func(ctx context.Context) ([]byte, error) {
		if atomic.AddInt32(&calls, 1) == 1 {
			return nil, errors.New("boom")
		}
		return []byte("ok"), nil
	}
	if _, _, err := s.Get(context.Background(), "k", false, fetch); err == nil {
		t.Fatal("want the error")
	}
	if body, state := mustGet(t, s, false, fetch); body != "ok" || state != Miss {
		t.Fatalf("after error: %s %s", body, state)
	}
}

func TestOldEntriesAreDropped(t *testing.T) {
	s, clock := newStore()
	release := make(chan struct{})
	close(release)
	fetch, _ := counter(release)
	mustGet(t, s, false, fetch)
	clock.Add(25 * time.Hour)
	if body, state := mustGet(t, s, false, fetch); body != "v2" || state != Miss {
		t.Fatalf("expired: %s %s", body, state)
	}
}

func TestPrefetchFillsTheCache(t *testing.T) {
	s, _ := newStore()
	release := make(chan struct{})
	close(release)
	fetch, _ := counter(release)
	s.Prefetch("k", fetch)
	waitFor(t, func() bool { _, st, _ := s.Get(context.Background(), "k", false, fetch); return st == Hit })
}

func waitFor(t *testing.T, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met in time")
		}
		time.Sleep(5 * time.Millisecond)
	}
}
