// Package cache keeps the encoded API responses in memory and makes sure GitLab is walked
// at most once at a time per key, whatever the number of requests.
package cache

import (
	"context"
	"log"
	"sync"
	"time"
)

// State tells how a response was served (the X-Cache header).
type State string

const (
	Hit   State = "HIT"   // fresh cached data
	Stale State = "STALE" // cached data older than the fresh period, refreshing in the background
	Miss  State = "MISS"  // fetched for this request
)

// Entry is an encoded response and the time its data was fetched.
type Entry struct {
	Body      []byte
	FetchedAt time.Time
}

// FetchFunc fetches and encodes the data of a key. It runs detached from the request that
// started it, under its own timeout.
type FetchFunc func(ctx context.Context) ([]byte, error)

// Store is safe for concurrent use.
type Store struct {
	fresh        time.Duration // served as HIT up to this age
	keep         time.Duration // served as STALE (and refreshed) up to this age, dropped after
	fetchTimeout time.Duration
	now          func() time.Time

	mu       sync.Mutex
	entries  map[string]*Entry
	inflight map[string]*call
}

type call struct {
	done  chan struct{}
	entry *Entry
	err   error
}

func New(fresh, keep, fetchTimeout time.Duration) *Store {
	return &Store{
		fresh:        fresh,
		keep:         keep,
		fetchTimeout: fetchTimeout,
		now:          time.Now,
		entries:      map[string]*Entry{},
		inflight:     map[string]*call{},
	}
}

// Get returns the data of key:
//   - fresh cached data right away (HIT);
//   - older cached data right away (STALE), while a refresh runs in the background;
//   - otherwise, or with refresh, it waits for a fetch (MISS).
//
// Concurrent requests for a key share a single fetch. The fetch doesn't depend on ctx: when
// the caller gives up (closed tab, proxy timeout), it goes on and its result is cached.
func (s *Store) Get(ctx context.Context, key string, refresh bool, fetch FetchFunc) (*Entry, State, error) {
	s.mu.Lock()
	s.purge()
	if entry := s.entries[key]; entry != nil && !refresh {
		if s.now().Sub(entry.FetchedAt) < s.fresh {
			s.mu.Unlock()
			return entry, Hit, nil
		}
		s.start(key, fetch)
		s.mu.Unlock()
		return entry, Stale, nil
	}
	c := s.start(key, fetch)
	s.mu.Unlock()

	select {
	case <-c.done:
		return c.entry, Miss, c.err
	case <-ctx.Done():
		return nil, Miss, ctx.Err()
	}
}

// Prefetch starts a fetch of key in the background (unless one is running) and returns
// without waiting.
func (s *Store) Prefetch(key string, fetch FetchFunc) {
	s.mu.Lock()
	s.start(key, fetch)
	s.mu.Unlock()
}

// start returns the running fetch of key, or starts one. Called with s.mu held.
func (s *Store) start(key string, fetch FetchFunc) *call {
	if c := s.inflight[key]; c != nil {
		return c
	}
	c := &call{done: make(chan struct{})}
	s.inflight[key] = c
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), s.fetchTimeout)
		defer cancel()
		body, err := fetch(ctx)
		s.mu.Lock()
		if err == nil {
			c.entry = &Entry{Body: body, FetchedAt: s.now()}
			s.entries[key] = c.entry
		} else {
			c.err = err
			log.Printf("cache: fetching %s failed: %v", key, err)
		}
		delete(s.inflight, key)
		s.mu.Unlock()
		close(c.done)
	}()
	return c
}

// purge drops the entries older than keep. Called with s.mu held.
func (s *Store) purge() {
	for key, entry := range s.entries {
		if s.now().Sub(entry.FetchedAt) >= s.keep {
			delete(s.entries, key)
		}
	}
}
