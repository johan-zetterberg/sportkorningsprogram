import re
import os

filepath = 'js/pages/speaker.js'

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix < div to <div
content = re.sub(r'< +([a-zA-Z][a-zA-Z0-9]*)', r'<\1', content)
# Fix </ div to </div>
content = re.sub(r'</ +([a-zA-Z][a-zA-Z0-9]*)', r'</\1', content)
# Fix div > to div>
# Note: be careful not to match logical comparison like (a > b)
# We only want to match when it's at the end of what looks like a tag
content = re.sub(r'([a-zA-Z0-9]"+) +>', r'\1>', content)
content = re.sub(r'([a-zA-Z0-9]) +>', r'\1>', content) # This one is riskier

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Finished cleaning.")
