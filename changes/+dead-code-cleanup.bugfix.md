Remove dead shell profile rendering code that was left after VIB-14 moved shell profiles to modal dialogs. The code referenced a non-existent `shell-profile-list` DOM element and was never called.
