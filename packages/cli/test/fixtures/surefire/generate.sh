#!/usr/bin/env bash
# Regenerates the Maven Surefire fixtures in this directory.
# Tool versions used: OpenJDK 24.0.2, Apache Maven 3.9.11, maven-surefire-plugin 3.6.0,
# maven-compiler-plugin 3.16.0, JUnit Jupiter 5.14.4 (junit-bom). See source/pom.xml.
# Surefire writes one TEST-<fqcn>.xml per top-level test class (nested @Nested classes land in the
# enclosing class's file). The <properties> block dumps the generating JVM's system properties
# (user.name, user.home, java.class.path, ...), so those values are machine-specific.
# mvn exits 1 because of deliberate failures; that is expected.
set -u
cd "$(dirname "$0")/source"

# 1. Default reporter, no reruns          -> target/surefire-reports/
mvn -B -q test || true
# 2. rerunFailingTestsCount=2 (profile)   -> target/surefire-reports-rerun/
#    equivalent to: mvn test -Dsurefire.rerunFailingTestsCount=2
mvn -B -q test -Prerun || true
# 3. JUnit5 phrased (display) names       -> target/surefire-reports-phrased/
mvn -B -q test -Pphrased || true

rm -rf ../surefire-reports ../surefire-reports-rerun ../surefire-reports-phrased
cp -R target/surefire-reports target/surefire-reports-rerun target/surefire-reports-phrased ..
rm -rf target

# Scripted sanitization of machine-specific strings (see ../README.md). The generation
# working dir (this source/ folder) becomes /work/surefire.
node ../../sanitize.mjs surefire "$PWD"
