# v3.8 Mobile Table UI Update

This update reorganizes the live game screen while preserving the existing game/network logic.

## What changed
- Clean 4-player cross layout: opponent seats at top, left and right; viewer at bottom.
- Dedicated 3-player positioning.
- Trick cards now have deterministic relative-position classes for stable placement.
- Trick winner card and result stay centered and clear.
- Game info HUD sits below the trick instead of covering cards.
- Player hand is separated from the table; the previous negative overlap was removed on mobile.
- Arrange / sort mode / Auto sort are arranged in one stable row below the hand.
- Contract and voice docks are reduced and moved to the top corners to avoid the play area.
- Score, chat, history and log panels remain available below the table.
- Mobile top bar, seat cards, cards and spacing were compacted for a cleaner phone layout.

## Logic preserved
No bidding rules, scoring rules, Socket.IO events, card legality, bot logic, voice logic, room logic, account logic or server rules were changed.
