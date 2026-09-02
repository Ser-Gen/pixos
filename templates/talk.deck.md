---
title: A deck in PixOS
author: You
theme: dark
---

::title
# Filmoskop

Slides that are just a markdown file.
::

::notes
This block never appears on the slide — it is for the presenter window.
Open it with **Speaker** and put it on your other screen.
::

-----

## Five dashes start a new slide

* Write ordinary markdown
* `-----` on a line of its own is the break
* The caret in the source scrolls the preview

::notes
The source and the slides are one window, so nothing has to be kept in sync by hand.
::

-----

::side-image{src="https://placehold.co/800x600/222/6fb3ff/png" align="right"}
### A picture beside the text

`::side-image{src="..." align="left"}` puts it on the other side.

The block is comark syntax — a component with props, not a special comment.
::

-----

::background-image{src="https://placehold.co/1600x900/111/333/png"}
# A picture behind the words

Add `dim="false"` to drop the shading.
::

-----

::columns
### Left

Two columns, side by side.

### Right

Each heading starts one.
::

-----

::quote
“A deck is a file, and a file is something you can keep.”
::

-----

## Code, highlighted

```css
.Slide {
	display: flex;
	align-items: center;
}
```

-----

::title
# Present it

**Present** goes fullscreen. **Export** writes one `.html` you can send to anyone.
::
