package auth

import (
	"fmt"
	"os"
	"testing"
)

func TestPRB12LogsInWithAValidPassword(t *testing.T) {
	if !Login("s3cret") {
		t.Fatal("expected login to succeed")
	}
}

func TestRejectsAWrongPassword(t *testing.T) {
	if got := Login("wrong"); got != true {
		t.Errorf("Login(%q) = %v, want %v", "wrong", got, true)
	}
}

func TestSupportsSSO(t *testing.T) {
	t.Skip("SSO provider not configured")
}

func TestLogin(t *testing.T) {
	t.Run("PRB-12 logs in with a valid password", func(t *testing.T) {
		if !Login("s3cret") {
			t.Fatal("expected success")
		}
	})
	t.Run("session", func(t *testing.T) {
		t.Run("refresh renews the token before expiry", func(t *testing.T) {})
	})
	t.Run("skipped subtest", func(t *testing.T) {
		t.Skip("not implemented yet")
	})
	t.Run("failing subtest", func(t *testing.T) {
		t.Error("subtest assertion failed")
	})
	t.Run("accepts café and ñandú", func(t *testing.T) {})
}

func TestUsernameLength(t *testing.T) {
	cases := []struct {
		name   string
		length int
	}{
		{"alice", 5},
		{"bob", 3},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if len(tc.name) != tc.length {
				t.Errorf("len(%q) = %d, want %d", tc.name, len(tc.name), tc.length)
			}
		})
	}
}

func TestPrintsToStdoutAndStderr(t *testing.T) {
	fmt.Println("hello from stdout")
	fmt.Fprintln(os.Stderr, "hello from stderr")
	t.Log("hello from t.Log")
}
