package testutil

import (
	"os"
	"runtime"
	"time"
)

func CountOpenFDs() (int, error) {
	files, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		return 0, err
	}
	return len(files), nil
}

func StabilizeRuntime() {
	runtime.GC()
	time.Sleep(200 * time.Millisecond)
}
