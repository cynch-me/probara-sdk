package me.probara.fixture;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;

class FlakyTest {

    // Reruns happen in the same JVM, so this counter survives between attempts.
    private static final AtomicInteger ATTEMPTS = new AtomicInteger();

    @Test
    void passesOnTheSecondAttempt() {
        int attempt = ATTEMPTS.incrementAndGet();
        System.out.println("attempt " + attempt);
        assertTrue(attempt >= 2, "fails on the first attempt only");
    }
}
