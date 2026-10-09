#!/usr/bin/env bash
# The schwung tag movy compiles C from. One definition, sourced by every build
# that takes schwung sources (the pinned chain host now, movy-host in WP6).
#
# Pinned, never the live checkout: the checkout follows origin/main (root
# CLAUDE.md), and compiling from it would make a build depend on the day it ran.
# A bump is a deliberate commit, gated like any other engine change.
SCHWUNG_PIN_TAG="${SCHWUNG_PIN_TAG:-v1.7.3}"
