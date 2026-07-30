// Dev utility: convert a world-pipeline diagnostic PNG into the map card
// thumbnail.webp (box-filter downscale to 700px wide, webp q45 — matching
// the existing world map thumbnails). Not part of the map generator build.
package main

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"

	"github.com/chai2010/webp"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: worldthumb <in.png> <out.webp>")
		os.Exit(1)
	}
	in, err := os.Open(os.Args[1])
	if err != nil {
		panic(err)
	}
	defer in.Close()
	src, err := png.Decode(in)
	if err != nil {
		panic(err)
	}
	b := src.Bounds()
	const targetW = 700
	outW := targetW
	outH := b.Dy() * targetW / b.Dx()
	dst := image.NewRGBA(image.Rect(0, 0, outW, outH))
	// Box-filter average over the source rectangle for each output pixel.
	for y := 0; y < outH; y++ {
		sy0 := b.Min.Y + y*b.Dy()/outH
		sy1 := b.Min.Y + (y+1)*b.Dy()/outH
		if sy1 <= sy0 {
			sy1 = sy0 + 1
		}
		for x := 0; x < outW; x++ {
			sx0 := b.Min.X + x*b.Dx()/outW
			sx1 := b.Min.X + (x+1)*b.Dx()/outW
			if sx1 <= sx0 {
				sx1 = sx0 + 1
			}
			var r, g, bl, n uint64
			for sy := sy0; sy < sy1; sy++ {
				for sx := sx0; sx < sx1; sx++ {
					cr, cg, cb, _ := src.At(sx, sy).RGBA()
					r += uint64(cr >> 8)
					g += uint64(cg >> 8)
					bl += uint64(cb >> 8)
					n++
				}
			}
			dst.SetRGBA(x, y, color.RGBA{
				R: uint8(r / n), G: uint8(g / n), B: uint8(bl / n), A: 255,
			})
		}
	}
	data, err := webp.EncodeRGBA(dst, 45)
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(os.Args[2], data, 0o644); err != nil {
		panic(err)
	}
	fmt.Printf("wrote %s (%dx%d, %d bytes)\n", os.Args[2], outW, outH, len(data))
}
