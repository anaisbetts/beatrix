---
name: Complex Frontmatter
configuration:
  enabled: true
  timeout: 5000
  retries: 3
tags:
  - home
  - automation
  - testing
conditions:
  - type: time
    value: "08:00:00"
  - type: state
    entity: light.living_room
    value: "on"
---

# Complex Frontmatter Automation

This automation has complex nested YAML frontmatter with arrays and objects. 