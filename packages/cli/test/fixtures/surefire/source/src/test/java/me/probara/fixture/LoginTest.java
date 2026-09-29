package me.probara.fixture;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestReporter;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class LoginTest {

    @Test
    @DisplayName("PRB-12 logs in with a valid password")
    void logsInWithAValidPassword() {
        assertEquals(2, 1 + 1);
    }

    @Test
    void rejectsAWrongPassword() {
        assertEquals("granted", "denied", "password check");
    }

    @Test
    void crashesOnAnUnexpectedException() {
        String token = null;
        token.length();
    }

    @Test
    @Disabled("SSO provider not configured")
    void supportsSso() {
        assertTrue(true);
    }

    @ParameterizedTest(name = "username {0} has length {1}")
    @CsvSource({"alice, 5", "bob, 3"})
    void usernameLength(String name, int length) {
        assertEquals(length, name.length());
    }

    @Test
    void recordsAProbaraCaseEntry(TestReporter reporter) {
        reporter.publishEntry("probara_case", "PRB-13");
        assertTrue(true);
    }

    @Test
    void printsToStdoutAndStderr() {
        System.out.println("hello from stdout");
        System.err.println("hello from stderr");
    }

    @Test
    @DisplayName("accepts café and ñandú")
    void acceptsUnicode() {
        assertTrue("café ñandú".contains("ñandú"));
    }

    @Nested
    class Session {
        @Nested
        class Refresh {
            @Test
            void renewsTheTokenBeforeExpiry() {
                assertEquals(2, new int[] {1, 2}.length);
            }
        }
    }
}
