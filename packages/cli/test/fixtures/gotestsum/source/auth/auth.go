package auth

// Login reports whether the password matches the stored one.
func Login(password string) bool { return password == "s3cret" }
