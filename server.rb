#!/usr/bin/env ruby
# Tiny static server for local viewing:  ruby server.rb  ->  http://localhost:8200/
require 'webrick'
root = File.expand_path(File.dirname(__FILE__))
port = (ENV['PORT'] || 8200).to_i
server = WEBrick::HTTPServer.new(Port: port, DocumentRoot: root,
  MimeTypes: WEBrick::HTTPUtils::DefaultMimeTypes.merge(
    'js' => 'text/javascript', 'mjs' => 'text/javascript',
    'webmanifest' => 'application/manifest+json'))
trap('INT') { server.shutdown }
puts "Life Planner -> http://localhost:#{port}/"
server.start
