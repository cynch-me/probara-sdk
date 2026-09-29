package billing

import "testing"

func TestChargesTheCard(t *testing.T) {}

// A panic aborts the whole test binary: tests after it in this package never run.
func TestCrashesOnAnUnexpectedPanic(t *testing.T) {
	var prices map[string]int
	prices["coffee"] = 3 // assignment to entry in nil map
}

func TestNeverRunsAfterThePanic(t *testing.T) {}
