# v24 — Full Hand Visibility

The hand now calculates card overlap from the actual visible table width. This fixes 26-card hands in the 4-player / 2-deck mode being cut off. Dense hands use a compact card size and the layout recalculates on resize/orientation change. If a very narrow screen still cannot physically fit the hand, horizontal scrolling remains available as a fallback.
