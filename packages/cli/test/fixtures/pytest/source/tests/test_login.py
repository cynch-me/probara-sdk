import sys

import pytest


def test_prb_12_logs_in_with_a_valid_password():
    """Case display id token in the function name."""
    assert 1 + 1 == 2


def test_rejects_a_wrong_password():
    assert "denied" == "granted"


def test_crashes_on_an_unexpected_exception():
    token = None
    token["value"]  # TypeError: 'NoneType' object is not subscriptable


@pytest.fixture
def broken_database():
    raise ConnectionError("database is unreachable")


def test_errors_in_fixture_setup(broken_database):
    assert broken_database


@pytest.mark.skip(reason="SSO provider not configured")
def test_supports_sso():
    assert True


class TestSession:
    class TestRefresh:
        def test_renews_the_token_before_expiry(self):
            assert [1, 2] == [1, 2]


@pytest.mark.parametrize("name,length", [("alice", 5), ("bob", 3)])
def test_username_length(name, length):
    assert len(name) == length


def test_records_a_probara_case_property(record_property):
    record_property("probara_case", "PRB-13")
    assert True


def test_prints_to_stdout_and_stderr():
    print("hello from stdout")
    print("hello from stderr", file=sys.stderr)


def test_accepts_café_and_ñandú():
    assert "ñandú" in "café ñandú"


@pytest.mark.parametrize("title", ["PRB-14 accepts café", "rejects ñandú"])
def test_unicode_parameter_ids(title):
    assert title
